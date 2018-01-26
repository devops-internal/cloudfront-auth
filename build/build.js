const shell = require('shelljs');
const prompt = require('prompt');
const fs = require('fs');
const axios = require('axios');
const colors = require('colors/safe');
const url = require('url');

var config = { AUTH_REQUEST: {}, TOKEN_REQUEST: {} };

prompt.message = colors.blue(">");
prompt.start();
prompt.get({
  properties: {
    method: {
      description: colors.red("Authentication methods:\n    (1) Google\n    (2) Microsoft\n    (3) GitHub\n    (4) Custom\n\n    Select an authentication method")
    }
  }
}, function (err, result) {
  switch (result.method) {
    case '1':
      googleConfiguration();
      break;
    case '2':
      microsoftConfiguration();
      break;
    case '3':
      githubConfiguration();
    case '4':
      //customConfiguration();
      console.log("Custom configuration not yet supported. Stopping build...");
      process.exit(1);
    default:
      console.log("Method not recognized. Stopping build...");
      process.exit(1);
  }
});

function microsoftConfiguration() {
  prompt.message = colors.blue(">>");
  prompt.start();
  prompt.get({
    properties: {
      TENANT: {
        message: colors.red("Tenant"),
        required: true
      },
      CLIENT_ID: {
        message: colors.red("Client ID"),
        required: true
      },
      CLIENT_SECRET: {
        message: colors.red("Client Secret"),
        required: true
      },
      REDIRECT_URI: {
        message: colors.red("Redirect URI"),
        required: true
      },
      TOKEN_AGE: {
        message: colors.red("Token Age (seconds)"),
        required: true
      }
    }
  }, function(err, result) {
    config.PRIVATE_KEY = fs.readFileSync('id_rsa', 'utf8');
    config.PUBLIC_KEY = fs.readFileSync('id_rsa.pub', 'utf8');
    config.DISCOVERY_DOCUMENT = 'https://login.microsoftonline.com/' + result.TENANT + '/.well-known/openid-configuration';
    config.TOKEN_AGE = parseInt(result.TOKEN_AGE, 10);

    config.CALLBACK_PATH = url.parse(result.REDIRECT_URI).pathname;

    config.AUTH_REQUEST.client_id = result.CLIENT_ID;
    config.AUTH_REQUEST.redirect_uri = result.REDIRECT_URI;
    config.AUTH_REQUEST.response_type = 'code';
    config.AUTH_REQUEST.response_mode = 'query';
    config.AUTH_REQUEST.scope = 'openid email';

    config.TOKEN_REQUEST.client_id = result.CLIENT_ID;
    config.TOKEN_REQUEST.grant_type = 'authorization_code';
    config.TOKEN_REQUEST.redirect_uri = result.REDIRECT_URI;
    config.TOKEN_REQUEST.client_secret = result.CLIENT_SECRET;

    shell.cp('./openid/authz/microsoft.js', './auth.js');
    shell.cp('./openid/index.js', './index.js');
    writeConfig(config, zipDefault);
    shell.exec('zip -q cloudfront-auth.zip config.json index.js package-lock.json package.json auth.js -r node_modules');
  });
}

function googleConfiguration() {
  prompt.message = colors.blue(">>");
  prompt.start();
  prompt.get({
    properties: {
      CLIENT_ID: {
        message: colors.red("Client ID"),
        required: true
      },
      CLIENT_SECRET: {
        message: colors.red("Client Secret"),
        required: true
      },
      REDIRECT_URI: {
        message: colors.red("Redirect URI"),
        required: true
      },
      HD: {
        message: colors.red("Hosted Domain"),
        required: true
      },
      TOKEN_AGE: {
        pattern: /^[0-9]*$/,
        description: colors.red("Token Age (seconds)"),
        message: colors.green("Entry must only contain numbers"),
        required: true
      },
      DISCOVERY_DOCUMENT: {
        message: colors.red("Discovery Document"),
        required: true
      },
      AUTHZ: {
        description: colors.red("Authorization methods:\n   (1) Hosted Domain - verify email's domain matches that of the given hosted domain\n   (2) HTTP Email Lookup - verify email exists in JSON array located at given HTTP endpoint\n   (3) Google Groups Lookup - verify email exists in one of given Google Groups\n\n   Select an authorization method")
      }
    }
  }, function(err, result) {
    config.PRIVATE_KEY = fs.readFileSync('id_rsa', 'utf8');
    config.PUBLIC_KEY = fs.readFileSync('id_rsa.pub', 'utf8');
    config.DISCOVERY_DOCUMENT = result.DISCOVERY_DOCUMENT;
    config.TOKEN_AGE = parseInt(result.TOKEN_AGE, 10);

    config.CALLBACK_PATH = url.parse(result.REDIRECT_URI).pathname;
    config.HOSTED_DOMAIN = result.HD;

    config.AUTH_REQUEST.client_id = result.CLIENT_ID;
    config.AUTH_REQUEST.response_type = 'code';
    config.AUTH_REQUEST.scope = 'openid email';
    config.AUTH_REQUEST.redirect_uri = result.REDIRECT_URI;
    config.AUTH_REQUEST.hd = result.HD;

    config.TOKEN_REQUEST.client_id = result.CLIENT_ID;
    config.TOKEN_REQUEST.client_secret = result.CLIENT_SECRET;
    config.TOKEN_REQUEST.redirect_uri = result.REDIRECT_URI;
    config.TOKEN_REQUEST.grant_type = 'authorization_code';

    shell.cp('./openid/index.js', './index-code.js');
    switch (result.AUTHZ) {
      case '1':
        shell.cp('./openid/authz/google.hosted-domain.js', './auth.js');
        writeConfig(config, zipDefault);
        shell.exec('zip -q cloudfront-auth.zip config.json index.js package-lock.json package.json auth.js -r node_modules');
        break;
      case '2':
        shell.cp('./openid/authz/google.http-email-lookup.js', './auth.js');
        prompt.start();
        prompt.message = colors.blue(">>>");
        prompt.get({
          properties: {
            HTTP_EMAIL_LOOKUP: {
              description: colors.red("Email lookup endpoint")
            }
          }
        }, function (err, result) {
          config.HTTP_EMAIL_LOOKUP = result.HTTP_EMAIL_LOOKUP;
          writeConfig(config, zipDefault);
        });
        break;
      case '3':
        googleGroupsConfiguration();
        break;
      default:
        console.log("Method not recognized. Stopping build...");
    }
  });
}

function googleGroupsConfiguration() {
  prompt.start();
  prompt.message = colors.blue(">>>");
  prompt.get({
    properties: {
      USER_EMAIL: {
        description: colors.red("User Email"),
        required: true
      }
    }
  }, function (err, result) {
    if (!shell.test('-f', './google-authz.json')) {
      console.log('Need google-authz.json to use google groups authentication. Stopping build...');
    } else {
      shell.cp('./openid/authz/google.groups-lookup.js', './auth.js');
      config.USER_EMAIL = result.USER_EMAIL;
      writeConfig(config, zipGoogleGroups);
    }
  });
}

function githubConfiguration() {
  prompt.message = colors.blue(">>>");
  prompt.start();
  prompt.get({
    properties: {
      CLIENT_ID: {
        message: colors.red("Client ID"),
        required: true
      },
      CLIENT_SECRET: {
        message: colors.red("Client Secret"),
        required: true
      },
      CALLBACK_PATH: {
        message: colors.red("Callback Path"),
        required: true
      },
      TOKEN_AGE: {
        pattern: /^[0-9]*$/,
        description: colors.red("Token Age (seconds)"),
        message: colors.green("Entry must only contain numbers"),
        required: true
      },
      AUTHORIZATION_ENDPOINT: {
        description: colors.red("Authorization Endpoint"),
        required: true
      },
      TOKEN_ENDPOINT: {
        description: colors.red("Token Endpoint"),
        required: true
      },
      ORGANIZATION: {
        description: colors.red("Organization (for AuthZ)"),
        required: true
      }
    }
  }, function(err, result) {
    axios.get('https://api.github.com/orgs/' + result.ORGANIZATION)
      .then(function (response) {
        if (response.status == 200) {
          result.PRIVATE_KEY = fs.readFileSync('id_rsa', 'utf8');
          result.PUBLIC_KEY = fs.readFileSync('id_rsa.pub', 'utf8');
          result.TOKEN_AGE = parseInt(result.TOKEN_AGE, 10);
          shell.cp('./oauth2/index.js', './index.js');
          writeConfig(result, zipDefault);
        } else {
          console.log("Organization could not be verified (code " + response.status + "). Stopping build...");
        }
      })
      .catch(function(error) {
        console.log("Organization could not be verified. Stopping build... (" + error.message + ")");
      });
  });
}

function zipDefault() {
  shell.exec('zip -q cloudfront-auth.zip config.json index.js package-lock.json package.json auth.js -r node_modules');
}

function zipGoogleGroups() {
  shell.exec('zip -q cloudfront-auth.zip config.json index.js package-lock.json package.json auth.js google-authz.json -r node_modules');
}

function writeConfig(result, callback) {
  fs.writeFile('config.json', JSON.stringify(result, null, 4), (err) => {
    if (err) throw err;
    callback();
  });
}