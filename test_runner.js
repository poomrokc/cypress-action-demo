const archiver = require('archiver');
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const axios = require('axios');

AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY_ID
});

// Promise Utility to zip folder
const zipDirectory = (source, out) => {
    const archive = archiver('zip', { zlib: { level: 9 }});
    const stream = fs.createWriteStream(out);

    return new Promise((resolve, reject) => {
        archive
        .directory(source, false)
        .on('error', err => reject(err))
        .pipe(stream)
        ;

        stream.on('close', () => resolve());
        archive.finalize();
    });
}

// Promise sleep
const sleep = (ms) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Upload file
const upload_build = (file_name) => {

    return new Promise((resolve, reject) => {
        fs.readFile(file_name, function (err, data) {
            if (err) { resolve(false) }
          
            var base64data = new Buffer.from(data, 'binary');

            var s3 = new AWS.S3();
            s3.putObject({
                Bucket: 'test-ci-cypress',
                Key: `build/${file_name}`,
                Body: base64data,
                ACL: 'private'
            },(resp) => {
                if(resp !== null) {
                    resolve(false);
                }
                s3.getSignedUrl('getObject', {
                    Bucket: 'test-ci-cypress',
                    Key: `build/${file_name}`,
                    Expires: 3600
                }, (err, url) => {
                    if(err) {
                        console.log(err);
                        resolve(false);
                    }
                    resolve(url);
                })
            });
          
        });
    });
}

// Fire github action
const github_action_start = async(token, test_branch, test_run_id, build_file_url) => {
    let url = 'https://api.github.com/repos/poomrokc/cypress-action-demo/actions/workflows/9812867/dispatches';

    let payload = {
        ref: test_branch,
        inputs: {
            test_run_id,
            build_file_url
        }
    };
    try {
        let res = await axios.post(url, payload, {headers:{
            'Content-Type': 'application/json',
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        }});
        return true;
    } catch(err) {
        return false;
    }
}

// Check sync file
const check_sync_file = (test_run_id) => {
    let key= `sync/${test_run_id}.sync`;
    let s3 = new AWS.S3();

    return new Promise((resolve, reject) => {
        s3.headObject({
            Bucket: 'test-ci-cypress',
            Key: key,
        }, function (err, metadata) {  
            if (err && err.code === 'NotFound') {
                resolve(false);
            } else {  
                s3.getObject({
                    Bucket: 'test-ci-cypress',
                    Key: key,
                }, function(err, data) {
                    if (err) {
                        console.log(err);
                        resolve(false);
                    } else {
                        resolve(data.Body.toString('ascii').trim());
                    }
                });
            }
        });
    });
}

// Get github action status
const github_action_stat = async(token, run_id) => {
    let url = `https://api.github.com/repos/poomrokc/cypress-action-demo/actions/runs/${run_id}`;
    try {
        let res = await axios.get(url, {headers:{
            'Content-Type': 'application/json',
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
        }});
        return res.data;
    } catch(err) {
        return false;
    }
}


// Main Test Runer
const main = async() => {
    // get the test uuid
    let test_run_id = process.env.HEROKU_TEST_RUN_ID;
    let test_branch = process.env.HEROKU_TEST_RUN_BRANCH;
    let github_token = process.env.GITHUB_TOKEN;

    // zip the build after it's finished
    let file_name = `${test_run_id}.zip`
    await zipDirectory(path.join(__dirname, 'dist'), path.join(__dirname, file_name));

    // upload the build 
    let upload_result = await upload_build(file_name);
    if(!upload_result){
        // failed uploading
        console.log("ERROR: Build uploading to S3 failed");
        process.exit(1);
    }
    console.log("Build file uploaded to S3");

    // fire github action
    let fire_action_result = await github_action_start(github_token, test_branch, test_run_id, upload_result);
    if(!fire_action_result) {
        // failed firing
        console.log("ERROR: Firing github actions failed");
        process.exit(1);
    }
    console.log("Github action started");

    // sync - finding the sync file on S3, wait for at most 10 minutes
    let synced = false;
    for(let i=0;i<60;i++) {
        synced = await check_sync_file(test_run_id);
        if(synced)
            break;
        await sleep(10000);
    }
    if(!synced) {
        console.log("ERROR: Synchronizing github actions failed");
        process.exit(1);
    }
    console.log(`Github action synced with run id ${synced}`);
    console.log(`Checking status every 30 seconds, to view logs, please go to https://github.com/poomrokc/cypress-action-demo/actions/runs/${synced}`)

    let conclusion = null;
    for(let i=0;i<10;i++) {
        let data = await github_action_stat(github_token, synced);
        console.log(new Date().toLocaleString(), 'STATUS:', data.status);
        if(data.status === "completed") {
            conclusion = data.conclusion;
            break;
        }
        await sleep(30000);
    }
    console.log('RESULT:', conclusion);
    if(conclusion.success === "success")
        process.exit(0);
    else
        process.exit(1);
}

main();