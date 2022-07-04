const express = require('express');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql');
const bcrypt = require('bcryptjs');
const jwt = require("jsonwebtoken");

require('dotenv').config();

const port = 3000;

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

app.use(cors({
  origin: '*'
}));

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", '*'); // update to match the domain you will make the request from
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// ----------SQL Connections-------
var con = mysql.createPool({
  host: "us-cdbr-east-05.cleardb.net",
  user: process.env.SQL_USER,
  password: process.env.SQL_PASSWORD,
  database: process.env.SQL_DATABASE
});

//---------------Stripe Integration Setup---------------
const endpointSecret = process.env.ENDPOINT_SECRET;
// Set your secret key. Remember to switch to your live secret key in production.
// See your keys here: https://dashboard.stripe.com/apikeys
const stripe = require('stripe')(process.env.STRIPE_LIVE_KEY);

//--------------Mailchimp Integration Setup-----------------

const mailchimp = require("@mailchimp/mailchimp_marketing");
mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: "us1",
});
// This function tests that the Mailchimp integration works
async function testMailchimp() {
  const response = await mailchimp.ping.get();
  console.log(response);
}
// testMailchimp();

//This function updates an existinf mailchimp list member
async function updateMailchimpMember(listId, email, newEmail, tags, firstName, lastName) {
  try{
    const response = await mailchimp.lists.setListMember(
      listId,
      email,
      { 
        email_address: newEmail, 
        status_if_new: "subscribed",
        tags: tags,
        merge_fields: {
          FNAME: firstName,
          LNAME: lastName
        } 
      }
    );
    return {
      "success": true
    };
  }catch(err){
    console.log(JSON.parse(err.response.res.text).detail);
    return {
      "success": false,
      "email_message": JSON.parse(err.response.res.text).detail
    };
  }
}

//--------NodeMailer Integration Setup---------------

let nodemailer = require('nodemailer');
const sendgridTransport = require('nodemailer-sendgrid-transport');
const { json } = require('body-parser');

//--------------User Auth and Account Management-------------------

let getUserData = (email) => {
  var sql = `SELECT *
            FROM users
            WHERE email = '${email}'`;
  return new Promise((resolve, reject)=>{
    con.query(sql, (err, result) => {
      if (err){
        return reject(err);
      } else {
        if(result.length > 0){
          return resolve({'foundUser': true, 'user': result[0]});
        } else {
          return resolve({'foundUser': false});
        }
      }
    });
  });
};

let deleteUser = (email) => {
  var sql = `DELETE
            FROM users
            WHERE email = '${email}'`;
  return new Promise((resolve, reject)=>{
    con.query(sql, (err, result) => {
      if (err){
        return reject(err);
      } else {
        if(result.affectedRows > 0){
          return resolve({'success': true});
        } else {
          return resolve({'success': false});
        }
      }
    });
  });
};

let updateUserData = (user) => {
  var sql = `UPDATE users
            SET email = '${user.new_email}', first_name = '${user.first_name}', last_name = '${user.last_name}'
            WHERE email = '${user.email}';`;
  return new Promise((resolve, reject)=>{
    con.query(sql, (err, result) => {
      if (err){
        return reject(err);
      } else {
        if(result.changedRows > 0){
          return resolve({'updateSuccessful': true});
        } else {
          return resolve({'updateSuccessful': false});
        }
      }
    });
  });
};

let updatePassword = (userEmail, hashedPassword) => {
  var sql = `UPDATE users
            SET password = '${hashedPassword}'
            WHERE email = '${userEmail}';`;
  return new Promise((resolve, reject)=>{
    con.query(sql, (err, result) => {
      if (err){
        return reject(err);
      } else {
        if(result.changedRows > 0){
          return resolve({'updateSuccessful': true});
        } else {
          return resolve({'updateSuccessful': false});
        }
      }
    });
  });
};

let updatePauseEmailStatus = (userEmail, pauseEmailStatus) => {
  var sql = `UPDATE users
            SET emails_paused = '${pauseEmailStatus}'
            WHERE email = '${userEmail}';`;
  return new Promise((resolve, reject)=>{
    con.query(sql, (err, result) => {
      if (err){
        return reject(err);
      } else {
        if(result.changedRows > 0){
          return resolve({'updateSuccessful': true});
        } else {
          return resolve({'updateSuccessful': false});
        }
      }
    });
  });
};

let addUser = async (user) => {
  let success = false;
  var sql = `INSERT INTO users VALUES (NULL, '${user.email}', '${user.password}', '${user.firstName}', 
    '${user.lastName}', 'user', '0')`;
    success = await con.query(sql, (err, result) => {
    if (err){
      console.log(err);
      return false
    }else{
      return true;
    }
  });
  return success;
};
// addUser();

const verifyJWT = (req, res, next) => {
  const token = req.headers["x-access-token"];

  if(!token){
    res.json({
      'auth': false,
      'message': 'No token'
    });
  } else {
    jwt.verify(token, process.env.TOKEN_KEY, (err, decoded) => {
      if(err){
        return res.json({
          'auth': false,
          'message': 'Failed to authenticate token. Please refresh the page'
        });
      } else {
        req.userEmail = decoded.email;
        next();
      }
    })
  }
};

app.get('/getUserInfo', verifyJWT, async (req, res) => {
  let userData = await getUserData(req.userEmail);
  if(!userData.foundUser){
    return res.status(500).send();
  }
  user = userData.user;
  let clientUserInfo = {
    'first_name': user.first_name,
    'last_name': user.last_name,
    'email': user.email,
    'emails_paused': user.emails_paused
  };
  return res.json({
    'auth': true,
    'message': `Successfuly authenticated as ${user.first_name} ${user.last_name} with email ${user.email}`,
    'user': clientUserInfo
  });
});

app.post('/updateUserInfo', verifyJWT, async (req, res) => {
  let user = {
    'first_name': req.body.first_name,
    'last_name': req.body.last_name,
    'email': req.userEmail,
    'new_email': req.body.new_email
  };
  if(user.first_name.length == 0){
    return res.json({
      'updateSuccessful': false,
      'message': 'First name can not be empty'
    });
  }
  if(user.first_name.length > 50){
    return res.json({
      'updateSuccessful': false,
      'message': 'First name can not be greater than 50 characters'
    });
  }
  if(user.last_name.length == 0){
    return res.json({
      'updateSuccessful': false,
      'message': 'Last name can not be empty'
    });
  }
  if(user.last_name.length > 50){
    return res.json({
      'updateSuccessful': false,
      'message': 'Last name can not be greater than 50 characters'
    });
  }
  if(user.new_email.length == 0){
    return res.json({
      'updateSuccessful': false,
      'message': 'Email can not be empty'
    });
  }
  if(user.new_email.length > 50){
    return res.json({
      'updateSuccessful': false,
      'message': 'Email can not be greater than 50 characters'
    });
  }
  //confirm user exists
  let getUserDataResult = await getUserData(req.userEmail);
  if(!getUserDataResult.foundUser){
    return res.status(500).send('User not found');
  }

  //update user in Mailchimp
  const listId = process.env.MAILCHIMP_MAIN_LISTID;
  let updateMailchimpResult = await updateMailchimpMember(listId, user.email, user.new_email, ['Free Pro Tester'], 
    user.first_name, user.last_name);
  if(!updateMailchimpResult.success){
    if(updateMailchimpResult.email_message == "Please provide a valid email address."){
      return res.json({
        'updateSuccessful': false,
        'message': "Please provide a valid email address"
      });
    }
    return res.json({
      'updateSuccessful': false,
      'message': "Please make sure the email address you have entered is valid. If it is please contact support@mydinnerpal.com :)"
    });
  }

  //continue response after updating user in Mailchimp
  let updateStatus = await updateUserData(user);
  if(updateStatus.updateSuccessful){
    let userData = await getUserData(user.new_email);
    if(!userData.foundUser){
      return res.status(500).send('User not found');
    }
    const token = jwt.sign(
      { email: userData.user.email },
      process.env.TOKEN_KEY,
      {
        expiresIn: "2h",
      }
    );
    return res.json({
      'updateSuccessful': true,
      'token': token,
    });
  } else if(!updateStatus.updateSuccessful){
    return res.json({
      'updateSuccessful': false,
      'message': 'Unable to update user info'
    });
  }
  return res.status(500).send();
});

app.post('/updatePassword', verifyJWT, async (req, res) => {
  if(req.body.password != req.body.confirmPassword){
    return res.json({
      'updateSuccessful': false,
      'message': 'Passwords do not match'
    });
  }
  if(req.body.password.length < 8){
    return res.json({
      'updateSuccessful': false,
      'message': 'Password can not be less than 8 characters'
    });
  }
  if(req.body.password.length > 50){
    return res.json({
      'updateSuccessful': false,
      'message': 'Password can not be greater than 50 characters'
    });
  }
  const hashedPassword = await bcrypt.hash(req.body.password, 10);
  let updateStatus = await updatePassword(req.userEmail, hashedPassword);
  if(updateStatus.updateSuccessful){
    let userData = await getUserData(req.userEmail);
    if(!userData.foundUser){
      return res.status(500).send('User not found');
    }
    const token = jwt.sign(
      { email: userData.user.email },
      process.env.TOKEN_KEY,
      {
        expiresIn: "2h",
      }
    );
    return res.json({
      'updateSuccessful': true,
      'token': token,
    });
  } else if(!updateStatus.updateSuccessful){
    return res.json({
      'updateSuccessful': false,
      'message': 'Unable to update user info'
    });
  }
  return res.status(500).send();
});

app.post('/updateEmailsPaused', verifyJWT, async (req, res) => {
  let emailsPaused = 0;
  const listId = process.env.MAILCHIMP_MAIN_LISTID;
  if(req.body.emailsPaused == 1){
    emailsPaused = 1;
    try{
      const response = await mailchimp.lists.updateListMemberTags(
        listId,
        req.userEmail,
        { tags: [{ name: "Free Pro Tester", status: "inactive" }] }
      );
    } catch(err){
      console.log(err);
      return res.json({
        'updateSuccessful': false,
        'message': 'Unable to pause meal plans. Please email support@mydinnerpal.com'
      });
    }
  }else{
    try{
      const response = await mailchimp.lists.updateListMemberTags(
        listId,
        req.userEmail,
        { tags: [{ name: "Free Pro Tester", status: "active" }] }
      );
    } catch(err){
      console.log(err);
      return res.json({
        'updateSuccessful': false,
        'message': 'Unable to resume meal plans. Please email support@mydinnerpal.com'
      });
    }
  }
  let updateStatus = await updatePauseEmailStatus(req.userEmail, emailsPaused);
  if(updateStatus.updateSuccessful){
    let userData = await getUserData(req.userEmail);
    if(!userData.foundUser){
      return res.status(500).send('User not found');
    }
    const token = jwt.sign(
      { email: userData.user.email },
      process.env.TOKEN_KEY,
      {
        expiresIn: "2h",
      }
    );
    return res.json({
      'updateSuccessful': true,
      'token': token,
    });
  } else if(!updateStatus.updateSuccessful){
    return res.json({
      'updateSuccessful': false,
      'message': 'Unable to update user info'
    });
  }
  return res.status(500).send();
});

app.post('/signup', async (req, res) => {
  let accessCodes = [process.env.ACCESS_CODE]
  if(!accessCodes.includes(req.body.accessCode)){
    return res.json({
      'auth': false,
      'message': 'Access code not found'
    });
  }
  const userData = await getUserData(req.body.email);
  if(userData.foundUser == true){
    return res.json({
      'auth': false,
      'message': 'This user already exists'
    });
  }
  if(req.body.password != req.body.confirmPassword){
    return res.json({
      'auth': false,
      'message': 'Passwords do not match'
    });
  }
  if(req.body.email.length == 0){
    return res.json({
      'updateSuccessful': false,
      'message': 'Email can not be empty'
    });
  }
  if(req.body.email.length > 50){
    return res.json({
      'updateSuccessful': false,
      'message': 'Email can not be greater than 50 characters'
    });
  }
  if(req.body.password.length < 8){
    return res.json({
      'updateSuccessful': false,
      'message': 'Password can not be less than 8 characters'
    });
  }
  if(req.body.password.length > 50){
    return res.json({
      'updateSuccessful': false,
      'message': 'Password can not be greater than 50 characters'
    });
  }
  if(req.body.firstName.length == 0){
    return res.json({
      'updateSuccessful': false,
      'message': 'First name can not be empty'
    });
  }
  if(req.body.firstName.length > 50){
    return res.json({
      'updateSuccessful': false,
      'message': 'First name can not be greater than 50 characters'
    });
  }
  if(req.body.lastName.length == 0){
    return res.json({
      'updateSuccessful': false,
      'message': 'Last name can not be empty'
    });
  }
  if(req.body.lastName.length > 50){
    return res.json({
      'updateSuccessful': false,
      'message': 'Last name can not be greater than 50 characters'
    });
  }
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const user = { email: req.body.email, password: hashedPassword, firstName: req.body.firstName, lastName: req.body.lastName };
    const token = jwt.sign(
      { email: user.email },
      process.env.TOKEN_KEY,
      {
        expiresIn: "2h",
      }
    );
    const listId = process.env.MAILCHIMP_MAIN_LISTID;
    const subscribingUser = {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email
    };
    try{
      const response = await mailchimp.lists.addListMember(listId, {
        email_address: subscribingUser.email,
        status: "subscribed",
        tags: ['Free Pro Tester'],
        merge_fields: {
          FNAME: subscribingUser.firstName,
          LNAME: subscribingUser.lastName
        }
      });
      // console.log(`Successfully added contact as an audience member. The contact's id is ${response.id}.`);
    } catch(err){
      if(JSON.parse(err.response.res.text).title == 'Member Exists'){
        //This email is already in Mailchimp, update the user's info in Mailchimp
        let updateMailchimpResult = await updateMailchimpMember(listId, subscribingUser.email, 
          subscribingUser.email, ['Free Pro Tester'], subscribingUser.firstName, subscribingUser.lastName);
        if(!updateMailchimpResult.success){
          if(updateMailchimpResult.email_message == "Please provide a valid email address."){
            return res.json({
              'updateSuccessful': false,
              'message': "Please provide a valid email address"
            });
          }
          return res.json({
            'updateSuccessful': false,
            'message': "Please make sure the email address you have entered is valid. If it is please contact support@mydinnerpal.com :)"
          });
        }
      }else{
        console.log(JSON.parse(err.response.res.text));
        return res.status(500).send();
      }
    }

    let addUserSuccess = await addUser(user);
    if(!addUserSuccess){
      return res.status(500).send();
    }

    return res.json({
      'auth': true,
      'message': 'Created user',
      'token': token
    });
  } catch(err) {
    console.log(err);
    return res.status(500).send();
  }
});

app.post('/login', async (req, res) => {
  // const user = users.find(user => user.email === req.body.email);
  const userData = await getUserData(req.body.email);
  if (userData.foundUser == false) {
    return res.json({
      'auth': false,
      'message': 'Cannot find user with that email'
    });
  }
  user = userData.user;
  try {
    if(await bcrypt.compare(req.body.password, user.password)) {
      const token = jwt.sign(
        { email: user.email },
        process.env.TOKEN_KEY,
        {
          expiresIn: "2h",
        }
      );
      user.token = token;
      res.json({
        'auth': true,
        'email': user.email,
        'token': user.token
      });
    } else {
      res.json({
        'auth': false,
        'message': 'Password invalid'
      });
    }
  } catch(err) {
    console.log(err);
    res.status(500).send();
  }
});

app.post('/send_password_reset_email', async (req, res) => {
  //Check if user exists-----------------------------
  const userData = await getUserData(req.body.email);
  if (userData.foundUser == false) {
    return res.json({
      'success': false,
      'message': 'Cannot find user with that email'
    });
  }
  user = userData.user;
  
  //Send password reset email to user--------------------
  try {
    const token = jwt.sign(
      { email: user.email },
      process.env.TOKEN_KEY,
      {
        expiresIn: "2h",
      }
    );

    let emailHTML = `
      <html>

      <head>
          <style>
              *{
                  font-family: Helvetica;
                  color: black;
              }
              h1 {
                  font-size: 21;
                  font-weight: 800;
              }
      
              h2 {
                  margin: 0;
                  font-size: 18;
                  font-weight: 500;
              }
      
              p {
                  margin: 0;
                  font-size: 12;
                  font-weight: 300;
              }
      
              .underline{
                  text-decoration: underline;
              }
      
              .bold{
                  font-weight: bold;
              }
      
              .center_div {
                  width: 100%;
                  display: flex;
                  justify-content: center;
              }
      
              #hero {
                  width: 100px;
                  margin-bottom: 20px;
              }
      
              .body_wrapper{
                  width: 95%;
                  margin: 0 2.5%;
              }
      
              .reset_password_button_wrapper{
                  margin: 20px 0;
              }
      
              .reset_password_button{
                  font-size: 19px;
                  font-weight: 700;
                  padding: 10px;
                  border: none;
                  outline: none;
                  text-decoration: none;
                  border-radius: 100px;
                  background-color: #EC7071;
              }
          </style>
      </head>
      
      <body>
          <div class="center_div">
              <img id="hero" src="cid:logo" />
          </div>
          <div class="body_wrapper">
              <div class="section_title">
                  <h1>Hi ${user.first_name},</h1>
              </div>
              <p>You recently requested to reset your My Dinner Pal password. Please use the button below to reset it :)</p>
              <p class="bold">This password reset link is only valid for the next 2 hours</p>
              <div class="reset_password_button_wrapper">
                  <a href="https://mydinnerpal.com/#/reset_password?token=${token}" class="reset_password_button" style="color:white;">Reset your password</a>
              </div>
              <p>If you did not request a password reset, please ignore this email or send an email to 
                  support@mydinner.com to report suspicious activity :)</p>
              <br>
              <hr>
              <p>If you're having trouble with the button above, copy and paste the following url into your 
                  browser: https://mydinnerpal.com/#/reset_password?token=${token}</p>
          </div>
      </body>
    `;
    let mailOptions = {
      from: 'no-reply@mydinnerpal.com',
      to: user.email,
      subject: `Reset your password`,
      html: emailHTML,
      attachments: [{
            filename: 'My_Dinner_Pal_Logo.png',
            path: './images/My_Dinner_Pal_Logo.png',
            cid: 'logo' //same cid value as in the html img src
        }
      ]
    };
  
  // Use this transporter for prod and testing sending out mass emails
    let transporter = nodemailer.createTransport({
      host: "smtp.sendgrid.net",
      port: 465,
      secure: true, // true for 465, false for other ports
      auth: {
        user: 'apikey', // generated ethereal user
        pass: `${process.env.SENDGRID_API_KEY}`// generated ethereal password
      }
    });
  
    transporter.sendMail(mailOptions, function(error, info){
        if (error) {
          return res.json({
            'success': false,
            'message': `Unable to send password reset email. Please email support@mydinnerpal.com and we'll handle it promptly :)`
          });
        }
    });
  } catch (error) {
    console.log(error);
    return res.status(500).send();
  }
  return res.json({
    'success': true 
  });
});

app.post('/deleteAccount', async (req, res) => {
  //Check if the user exists
  const userData = await getUserData(req.body.email);
  if (userData.foundUser == false) {
    return res.status(500).send('User not found');
  }

  //Archive member in Mailchimp
  const listId = process.env.MAILCHIMP_MAIN_LISTID;
  try {
    const response = await mailchimp.lists.deleteListMember(
      listId,
      userData.user.email
    );
    // console.log(response);
  } catch(err) {
    console.log(err);
    return res.json({
      'updateSuccessful': false,
      'message': `Unable to delete your email in Mailchimp. Please email support@mydinnerpal.com and we'll handle it promptly :)`
    });
  }

  //Delete member in SQL database
  let deleteUserResult = await deleteUser(userData.user.email);
  if(deleteUserResult.success==true){
    return res.json({
      'updateSuccessful': true 
    });
  }
  return res.json({
    'updateSuccessful': false,
    'message': `Failed to delete account in our backend. Please email support@mydinnerpal.com and we'll handle it promptly :)`
  });
});

//-------------Stripe Integration------------------


// This function is for if we ever want to charge one off payments
// It currently charges a static amount of $10.99
app.post('/pay', async (req, res) => {
    const {email} = req.body['email'];
    const {firstName} = req.body['first_name'];
    const {lastName} = req.body['last_name'];
    const {customer} = {
      "email": email,
      "name": firstName+" "+lastName,
    };

    const paymentIntent = await stripe.paymentIntents.create({
        amount: 1099,
        currency: 'usd',
        // Verify your integration in this guide by including this parameter
        metadata: {integration_check: 'accept_a_payment'},
        customer: customer,
        receipt_email: email,
    });
    res.json({'client_secret': paymentIntent['client_secret']})
});

app.post('/sub', async (req, res) => {
  try {  
    const {email, payment_method, firstName, lastName, plan, billCycle} = req.body;
    let err={'raw': {'message': 'Information is incomplete'}, 'code': 'incomplete_information'};
    // throw err;

    if(firstName == ""){
        err.raw.message = 'First name is incomplete';
        err.code = 'firstName_incomplete';
        throw err;
    }
    if(lastName == ""){
        err.raw.message = 'Last name is incomplete';
        err.code = 'lastName_incomplete';
        throw err;
    }
    if(email == ""){
        err.raw.message = 'Email is incomplete';
        err.code = 'email_incomplete';
        throw err;
    }
    
    let price = '';
    if(plan === 'Pro'){
      if(billCycle === 'year'){
        price = 'price_1IyKcKKIKjam29K6nSX68amw';
      }else if(billCycle === 'month'){
        price = 'price_1IyKcKKIKjam29K6mHw6WQtx';
      }else{
        err.raw.message = 'Contact us for support! Bill Cycle value unexpected';
        err.code = 'billCycle_unexpected';
        throw err;
      }
    } else if(plan === 'Ideas Only'){
      if(billCycle === 'year'){
        price = 'price_1IyKduKIKjam29K6YNcjHiH5';
      }else if(billCycle === 'month'){
        price = 'price_1IyKduKIKjam29K6J7mLhQOH';
      }else{
        err.raw.message = 'Contact us for support! Bill Cycle value unexpected';
        err.code = 'billCycle_unexpected';
        throw err;
      }
    }else{
      err.raw.message = 'Contact us for support! Plan value unexpected';
      err.code = 'planValue_unexpected';
      throw err;
    }

    const customer = await stripe.customers.create({
      payment_method: payment_method,
      email: email,
      name: firstName+" "+lastName,
      invoice_settings: {
        default_payment_method: payment_method,
      },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ plan: price }],
      trial_period_days: '30',
      expand: ['latest_invoice.payment_intent']
    });

    const setupIntentList = await stripe.setupIntents.list({
      'customer': customer.id
    });
    const setupIntent = setupIntentList.data[0];

    const status = setupIntent['status']; 
    const client_secret = setupIntent['client_secret'];

    // console.log(status);
    // console.log(client_secret);

    res.json({'client_secret': client_secret, 'status': status});
  } catch (error) {
    console.log('There was an error');
    console.log(error);
    res.json(error);
  }
});

//-------------MailChimp Integration--------------

app.post('/hooks', bodyParser.raw({type: 'application/json'}), async (req, res) => {
  console.log("Running hooks");
  
  try {
    // console.log(req.body.type);
    if(req.body.type === "setup_intent.succeeded"){
      // The customer below is used for testing
      // const customer = await stripe.customers.retrieve('cus_JXRYR5nFi5sQ6J');
      const customer = await stripe.customers.retrieve(req.body.data.object.customer);
      
      let firstName = '';
      let lastName = '';
      if(customer.name !== null){
        var fullName = customer.name.split(' ');
        firstName = fullName[0];
        lastName = fullName[fullName.length - 1];
      }

      const subscriptions = await stripe.subscriptions.list({
        customer: customer.id,
      });

      const productId = subscriptions.data[subscriptions.data.length-1].items.data[0].price.product;
      const product = await stripe.products.retrieve(productId);
      console.log(product.name);
      let planName = 'Special Product';
      switch (product.name){
        case 'Pro Plan':
          planName = 'Pro';
          break;
        case 'Ideas Only Plan':
          planName = 'Ideas Only';
          break;
      }
  
      const listId = process.env.MAILCHIMP_MAIN_LISTID;
      const subscribingUser = {
        firstName: firstName,
        lastName: lastName,
        email: customer.email
      };
      const response = await mailchimp.lists.addListMember(listId, {
        email_address: subscribingUser.email,
        status: "subscribed",
        tags: [planName],
        merge_fields: {
          FNAME: subscribingUser.firstName,
          LNAME: subscribingUser.lastName
        }
      });
      console.log(`Successfully added contact as an audience member. The contact's id is ${response.id}.`);
      
      console.log('sent message');
      res.json({'message': 'You good on our end'});
    }
  }catch (err){
    try {
      const deleted = await stripe.customers.del(req.body.data.object.customer);

      console.log('customer deleted');
      console.log(deleted);
    }catch (error){
      console.log('Error deleting customer');
      console.log(error);
    }

    console.log("There was an error");
    // console.log(err);
    console.log(err);
    res.json(err);
  }
});

app.listen(process.env.PORT || port, () => console.log(`My Dinner Pal Backend listening on port ${port}!`))