const fs = require("fs");
const https = require("https");
const dateFormat = require("dateformat");

const config = JSON.parse(fs.readFileSync("config.json"));

var now = new Date();
var prevPayDay = new Date(now.getFullYear(), now.getMonth() - 1, config.payDate);
var currentPayDay = new Date(now.getFullYear(), now.getMonth(), config.payDate);
var nextPayDay = new Date(now.getFullYear(), now.getMonth() + 1, config.payDate);

// Calculate full-time working hours up to current pay day
var prevFullTimeHours = 0;
for(var date = prevPayDay; date.getTime() < currentPayDay.getTime(); date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
    if(date.getDay() != 0 && date.getDay() != 6) { // Skip weekends
       prevFullTimeHours += config.fullTimeHoursPerDay;
    }
}

// Calculate full-time working hours up to next pay day
var currentFullTimeHours = 0;
for(var date = currentPayDay; date.getTime() < nextPayDay.getTime(); date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)) {
    if(date.getDay() != 0 && date.getDay() != 6) { // Skip weekends
       currentFullTimeHours += config.fullTimeHoursPerDay;
    }
}

var issues = []; // Worked-on issues are collected here
var workLogs = []; // Work logs are collected here
var authors = []; // Employees are collected here

var jql = "timespent > 0 and worklogDate >= '" + dateFormat(prevPayDay, "yyyy-mm-dd") + "'";
// Example: assignee = $assignee and project = $project and created < $toDate and updated > $fromDate and timespent > 0

// Fetch issues with work logged on them recently
https.get({
   hostname: config.hostname,
   port: config.port,
   path: "/rest/api/2/search?startIndex=0&fields=summary&maxResults=1000000&jql=" + encodeURIComponent(jql),
   auth: config.auth
}, (issuesResponse) => {
    var issuesBody = "";

    issuesResponse.on("data", (issuesChunk) => {
        issuesBody += issuesChunk;
    });
    
    issuesResponse.on("end", () => {
        var issuePromises = []; // Promises for per-issue (work log) queries are collected here
        JSON.parse(issuesBody).issues.forEach((issueData) => {
            var issue = {
                id: issueData.id,
                key: issueData.key,
                summary: issueData.fields.summary,
                workLogs: [], // Work logs per issue are collected here
                workLogAuthors: [] // Employees per work log are collected here
            };
            issues.push(issue);

            issuePromises.push(new Promise((resolve, reject) => {
                https.get({
                    hostname: config.hostname,
                    port: config.port,
                    path: "/rest/api/2/issue/" + issue.key + "/worklog",
                    auth: config.auth
                }, (workLogResponse) => {
                    var workLogBody = "";

                    workLogResponse.on("data", (workLogChunk) => {
                        workLogBody += workLogChunk;
                    });

                    workLogResponse.on("end", () => {
                        JSON.parse(workLogBody).worklogs.forEach((workLogData) => {
                            var author = authors.find((element) => {
                                return element.key == workLogData.author.key;
                            });
                            if(!author) {
                                author = {
                                    key: workLogData.author.key,
                                    name: workLogData.author.name,
                                    displayName: workLogData.author.displayName,
                                    issues: [], // Issues per employee are collected here
                                    workLogs: [] // Work logs per employee are collected here
                                };
                                authors.push(author);
                            }
                            if(!author.issues.find((element) => {
                                return element == issue;
                            })) {
                                author.issues.push(issue);
                            }
                            if(!issue.workLogAuthors.find((element) => {
                                return element == author;
                            })) {
                                issue.workLogAuthors.push(author);
                            }
                            
                            var workLog = {
                                id: workLogData.id,
                                issue: issue,
                                started: new Date(workLogData.started),
                                duration: workLogData.timeSpentSeconds * 1000,
                                author: author,
                                comment: workLogData.comment
                            };
                            workLogs.push(workLog);
                            issue.workLogs.push(workLog);
                            author.workLogs.push(workLog);
                        });

                        resolve();
                    });
                });
            }));
        });

        // Generate report when promises are fulfilled
        Promise.all(issuePromises).then(() => {
            console.log();
            console.log("Previous pay day:", dateFormat(prevPayDay, "dddd, mmmm d, yyyy"));
            console.log("Current pay day:", dateFormat(currentPayDay, "dddd, mmmm d, yyyy"));
            console.log("Next pay day:", dateFormat(nextPayDay, "dddd, mmmm d, yyyy"));
            console.log();
            console.log("Full-time work hours up to current pay day:", prevFullTimeHours);
            console.log("Full-time work hours up to next pay day:", currentFullTimeHours);
            console.log();

            authors.forEach((author) => {
                console.log(author.displayName.toUpperCase());
                console.log();

                // TODO: Sort all the other arrays?
                author.workLogs.sort((a, b) => {
                    return a.started.getTime() - b.started.getTime(); 
                });

                var prevHoursWorked = 0;
                author.workLogs.filter((workLog) => {
                    return workLog.started.getTime() < currentPayDay.getTime();
                }).forEach((workLog) => {
                    prevHoursWorked += workLog.duration / 3600000;
                });
                console.log("Time worked up to current pay day:", prevHoursWorked.toFixed(1), "hours /", ((prevHoursWorked * 100) / prevFullTimeHours).toFixed(1), "percent");
                var currentHoursWorked = 0;
                author.workLogs.filter((workLog) => {
                    return workLog.started.getTime() >= currentPayDay.getTime() && workLog.started.getTime() < nextPayDay.getTime();
                }).forEach((workLog) => {
                    currentHoursWorked += workLog.duration / 3600000;
                });
                console.log("Time worked up to next pay day:", currentHoursWorked.toFixed(1), "hours /", ((currentHoursWorked * 100) / currentFullTimeHours).toFixed(1), "percent");
                console.log();

                console.log("Issues worked on:");
                console.log();
                author.issues.forEach((issue) => {
                    var issueHoursWorked = 0;
                    issue.workLogs.filter((workLog) => {
                        return workLog.author == author;
                    }).forEach((workLog) => {
                        issueHoursWorked += workLog.duration / 3600000;
                    });
                    console.log(issue.key, issue.summary, "-", issueHoursWorked.toFixed(1), "hours");
                });
                console.log();
            });
        });
    });
});
