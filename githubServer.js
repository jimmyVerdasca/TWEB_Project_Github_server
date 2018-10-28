const fetch = require('node-fetch');
var utils = require('./utils');
var parse = require('parse-link-header');
let util = new utils();

/**
 * response class sent when a fetch fail
 */
class ResponseError extends Error {
  constructor(res, body) {
    super(`${res.status} error requesting ${res.url}: ${res.statusText}`);
    this.status = res.status;
    this.path = res.url;
    this.body = body;
  }
}

/**
 * class managing the connexion to the github API.
 * 
 * This class could be improve with a cache that store usefull
 * information instead of asking at every request to github API rest.
 */
class Github {
  constructor(token, baseUrl = 'https://api.github.com') {
    this.token = token;
    this.baseUrl = baseUrl;
  }

  /**
   * method sending a request to the given path url. and return the body datas.
   * @param {url of the request} path 
   * @param {dictionary used by github to navigate through big data answers} search_opt 
   * @param {boolean indicating that we want only the headers of the response} onlyHeaders 
   * @param {dictionnary to add specific headers to the request} opts 
   */
  request(path, search_opt = {}, onlyHeaders = false, opts = {}) {
    let url = `${this.baseUrl}${path}?${util.dictToFormattedString(search_opt)}`;
    const options = {
      ...opts,
      headers: {
        Accept: 'application/vnd.github.cloak-preview+application/vnd.github.v3+json',
        Authorization: `token ${this.token}`
      },
    };
    
    return fetch(url, options)
      .then(res => {
        return res.json()
          .then((data) => {
            if (!res.ok) {
              throw new ResponseError(res, data);
            }
            if (onlyHeaders) {
              return res.headers;
            }
            return data;
          })
      });
  }

  /**
   * Method sending a request to get the users informations from github
   * @param {seed of the first user we want} since 
   */
  users(since) {
    let nb_users_wanted = 5; // Minimum: 1, Maximum: 100 We could improve by taking it from the client request
    return this.request('/users', {'since':since,'page':1,'per_page':nb_users_wanted});
  }

  /**
   * method sending a request to get the users informations from github
   * and formatting them to keep only the specified meta informations
   * in the info dictionnary.
   * @param {seed of the first user we want} since 
   * @param {list of the meta informations we want to keep} info 
   */
  userInfo(since, info = ['login']) {
    return this.users(since)
      .then(infos_users => {
        let infos = [];
        for (let i = 0; i < infos_users.length; i++) {
          let user_info = {};
          for (let j = 0; j < info.length; j++) {
            user_info[info[j]] = infos_users[i][info[j]];
          }
          infos.push(user_info);
        }
        return infos;
      });
  }

  /**
   * method sending a request to get the users informations and keeping only:
   * the username
   * the avatar
   * the number of followers
   * @param {seed of the first user we want} since 
   */
  followers(since) {
    return this.users(since).then((function(infos_users) {
      let cleaned_infos_users = [];
      let cleaned_user = {};
      let url_follower = '';
      let followers_promises = [];

      //Ask to github the followers of the current iterated user and put the promise in followers_promises
      for (let i = 0; i < infos_users.length; i++) {
        let user = infos_users[i];
        url_follower = user['followers_url'].replace(this.baseUrl,'');
        followers_promises.push(this.request(url_follower, {"per_page": 1}, true));

        // Add the username, the image avatar url and the id to the final answer
        cleaned_user = {'login': user['login'],
                        'avatar_url': user['avatar_url'],
                        'id': user['id']
                      };
        cleaned_infos_users.push(cleaned_user);
      }

      // Wait followers promises to be resolved before calculating the number of followers of the users
      return Promise.all(followers_promises).then(list_followers => {
        for (let i = 0; i < list_followers.length; i++) {
          if (parse(list_followers[i].get('Link')) !== null) {
            cleaned_infos_users[i]['nb_followers'] = parse(list_followers[i].get('Link'))['last']['page'];
          } else {
            cleaned_infos_users[i]['nb_followers'] = 0;
          }
        }
        return cleaned_infos_users;
      });
    }).bind(this));
    
  }

  /**
   * Request to github the number of repositories of a given user.
   * @param {username of the user we want the number of repositories} user 
   * Return 0 if the request fail or the answer is empty.
   */
  nbRepositoriesOf(user) {
    return this.repositoriesOf(user)
      .then(repos => {
        if(repos === undefined) {
          return 0;
        }
        return repos['total_count']
      }).catch(err => {return 0})
  }

  /**
   * Request to github the repositories of a given user (fork are considered aswell).
   * @param {username of the user we want the repositories} user 
   * Return undefined if the request fails (happen when repeateadly ask the repositories of a private user)
   */
  repositoriesOf(user) {
    let search_options = {'q':util.dictToSearchOption({'user':user, 'fork': 'true'})};
    return this.request('/search/repositories', search_options)
      .catch(err => {
        return undefined;
      });
  }

  /**
   * Use a recursive strategy to request all the commits message of a given user.
   * @param {username of the user we want the commits} user 
   * @param {number of the page the where the recursive call is} page 
   * @param {list of the commits message currently found} commit_msg 
   */
  commitsOf(user, page = 1, commit_msg = []) {
    let search_options = {'page':page++, 'per_page': 100, 'q':util.dictToSearchOption({'author':user})};
    return this.request('/search/commits', search_options)
        .then(commits => {
          if (commits) {
            for (let i = 0; i < commits['items'].length; i++) {
              commit_msg.push(commits['items'][i]['commit']['message']);
            } 
            return this.commitsOf(user, page, commit_msg); // recursive call to next page
          }
          return commit_msg; // No more pages we can return the commit list
        }, error => {
          return commit_msg; // If a commit request fail we don't consider this page and return the current list
        });
  }

  /**
   * request to github to get the number of commits of a given user
   * @param {username of the user we want the number of commits} user 
   */
  nbCommitsOf(user) {
    let search_options = {'q':util.dictToSearchOption({'author':user})};
    return this.request('/search/commits', search_options)
      .catch(err => {
        return {'total_count': 0};
      })
      .then(commits => {
        return commits['total_count'];
      });
  }

  /**
   * request to github the lines code of a user and calculate their total number to return it.
   * Github return the list of weekly lines of code added. We need to iterate through it.
   * @param {username of the user we want the number of line code} user 
   */
  nbLinesOf(user) {
    let nb_lines = 0;
    return this.repositoriesOf(user)
      .catch(err => {
        return undefined;
      })
      .then(repos_data => {
        if(repos_data === undefined) {
          return 0;
        }
        let per_page = 30;
        let nb_repos = repos_data['total_count'];
        let repos = repos_data['items'];
        let names_repos = [];

        // foreach repositories
        if(repos != []) {
          for (let i = 0; i < nb_repos; i++) {
            let page = Math.ceil((i  + 1) / per_page)
            let index_on_page = i - (page - 1) * per_page
            if(repos[index_on_page] !== undefined) {

              // We ask the contributions of a user for this repos
               names_repos.push(this.request(`/repos/${repos[index_on_page]['full_name']}/stats/contributors`, {'page':page})
                .catch(err => {
                  return undefined;
                })
                .then(contributions_data => {
                  // Then we add weekly number of lines
                  if (contributions_data !== undefined) {
                    for (let i = 0; i < contributions_data.length; i++) {
                      for (let k = 0; k < contributions_data[i]['weeks'].length; k++) {
                        nb_lines += contributions_data[i]['weeks'][k]['a']
                      }
                    }
                  }
                  return nb_lines
              }));
              Promise.all(names_repos.slice(names_repos.lenght, names_repos.length + 1))
                .then(result => {
                  return nb_lines;
                });
            } 
          }
        } 

        // We wait for all promise to finish to return the number of total lines of the user
        return Promise.all(names_repos)
        .then(result => {
          return nb_lines;
        })
      })
  }

  /**
   * request to github multiple statistics and information of several users.
   * the kept informations are :
   * the username
   * the avatar
   * the number of code lines
   * the number of commit
   * the number of repositories
   * @param {seed of the first user we want the statistics} since 
   */
  stats(since) {
    return this.userInfo(since, ['login', 'avatar_url'])
      .then(name_and_avatar => {
        let statistics = [];
        for (let i = 0; i < name_and_avatar.length; i++) {
          let name = name_and_avatar[i]['login'];
          let avatar = name_and_avatar[i]['avatar_url'];
          statistics.push(Promise.all([this.nbLinesOf(name), this.nbCommitsOf(name), this.nbRepositoriesOf(name)])
          .then(result => {
            return {'username': name,
                    'avatar_url': avatar,
                    'nb_lines': result[0],
                    'nb_commit': result[1],
                    'nb_repos': result[2]
                    };
          
          }));
        }
        return Promise.all(statistics)
        .then(result => {
            return result;
          });
      }
    ).catch(err => {
      console.log(err);
    });
  }
}

module.exports = Github;