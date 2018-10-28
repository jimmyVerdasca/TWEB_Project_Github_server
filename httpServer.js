require('dotenv').config();
var express = require('express');
var app = express();
var url = require('url');
var github = require('./githubServer');

let git = new github(process.env.TOKEN);

console.log('Connected');

/**
 * When this server get a /commit request, He ask to github all the commits of a user
 * return to the client the formatted answer
 */
app.get('/commit', function(req, res) {
    let q = url.parse(req.url, true);
    let user = q.query['user'];
    console.log("asking to github commits of : " + user);

    git.commitsOf(user)
        .then(data => {
            try {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.json(data);
                console.log("commits sent back to client");
            } catch(err) {
                console.log(err);
            }
        });
});
  
/**
 * When this server get a /follower request, He ask to github 100 user from the given seed and keep only
 * 1) the username
 * 2) the avatar
 * 3) the number of followers
 * return to the client the formatted answer
 */
app.get('/follower', function(req, res) {
    let q = url.parse(req.url, true);
    let seed = q.query['seed'];
    console.log("asking to github users with starting seed : " + seed);

    git.followers(seed)
    .then(data => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json(data);
        console.log("users sent back to client");
    }).catch(err => {
        console.log(err);
    });
});

/**
 * When this server get a /stat request, He ask to github 
 * 1) the number of commits
 * 2) the number of lines
 * 3) the number of repositories
 * return to the client the formatted answer
 */
app.get('/stat', function(req, res) {
    let q = url.parse(req.url, true);
    let seed = q.query['seed'];
    console.log("asking to github statistics with starting seed : " + seed);

    git.stats(seed)
    .then(data => {
        try {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.json(data);
            console.log("statistics sent back to client");
        } catch(err) {
            console.log(err);
        }
    })
});

/**
 * If the path of the request is unknow,
 * we send back to the client a 404 not found.
 */
app.get('*', function(req, res){
    let q = url.parse(req.url, true);
    console.log(q + " pathname not found");
    res.status(404).send(q + " pathname not found");
    console.log("404 sent to client");
});

app.listen(process.env.PORT);