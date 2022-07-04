# My Dinner Pal Backend API

This repo contains the backend application for mydinnerpal.com. Make with Node.js and Express.js. Includes integrations with Stripe (recurring payments) and Mailchimp APIs, user auth using JWTs, built ‘mass emailer’ using SendGrid SMTP and Nodemailer (just used for password recovery in production but used for meal plan distribution in features that are currently just in dev)

<img src="images/My_Dinner_Pal_Logo.png" alt="logo" width="100"/>

This API contains the following enpoints for the frontend application and for webhooks that are connected to it:

## User Auth and Account Management

* '/getUserInfo' - (GET) - (Requires Authentication) - Returns user's basic account info
* '/updateUserInfo' - (POST) - (Requires Authentication) - Updates user's basic account info
* '/updatePassword' - (POST) - (Requires Authentication) - Updates user's password
* '/updateEmailsPaused' - (POST) - (Requires Authentication) - Updates user's "emails paused" status
* '/signup' - (POST) - (No Authentication) - Creates a new user in database
* '/login' - (POST) - (No Authentication) - Validates user's credentials and returns token if valid
* '/send_password_reset_email' - (POST) - (No Authentication) - Send's user password reset email if user exists in database
* '/deleteAccount' - (POST) - (Requires Authentication) - Deletes user's account

## Stripe Integration

* '/pay' - (POST) - Used for testing. Creates a payment intent to charge a customer a static price of $10.99
* '/sub' - (POST) - Subscribes a paying customer to the appropriate payed email list and returns a client secret

## MailChimp Integration

* '/hooks' - (POST) - Expects a post request from a particular Stripe webhook and uses the information in that webhook to subscribe a given ayingcustomer to the appropriate paid email list