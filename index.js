const express = require('express');
const app = express();
const cors = require('cors');
const bodyParser = require('body-parser');
// Set your secret key. Remember to switch to your live secret key in production.
// See your keys here: https://dashboard.stripe.com/apikeys
const stripe = require('stripe')('sk_test_51IgxffKIKjam29K6l4vYNoFkFAMBDpN6SgyhLEUb9V1tSWp0zGfSEAoDavaXOeazfWk4MgdzXL35aZ9hLwf4V6VG00EBzhvqJu');
const mailchimp = require("@mailchimp/mailchimp_marketing");
mailchimp.setConfig({
  apiKey: "138672d945f160131700e77c12c3000a-us1",
  server: "us1",
});
// This function tests that the Mailchimp integration works
// async function run() {
//   const response = await mailchimp.ping.get();
//   console.log(response);
// }
// run();

const port = 3000;

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

app.use(cors());

app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', "*");
    res.header('Access-Control-Allow-Methods','GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

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
        price = 'price_1ItJN0KIKjam29K6uHPGOeym';
      }else if(billCycle === 'month'){
        price = 'price_1ItJN0KIKjam29K6wZaABUlD';
      }else{
        err.raw.message = 'Contact us for support! Bill Cycle value unexpected';
        err.code = 'billCycle_unexpected';
        throw err;
      }
    } else if(plan === 'Ideas Only'){
      if(billCycle === 'year'){
        price = 'price_1ItJQvKIKjam29K65EjKKfvp';
      }else if(billCycle === 'month'){
        price = 'price_1ItJQuKIKjam29K6z6zl5gvp';
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
    // console.log(error);
    res.json(error);
  }
});

app.post('/hooks', bodyParser.raw({type: 'application/json'}), async (req, res) => {
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

      // console.log("#####");
      // console.log(subscriptions.data[subscriptions.data.length-1].items.data);

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
  
      const listId = "e2d0a5fb98";
      const subscribingUser = {
        firstName: firstName,
        lastName: lastName,
        email: customer.email
      };
      const response = await mailchimp.lists.addListMember(listId, {
        email_address: subscribingUser.email,
        // email_address: "kc683dude@gmail.com",
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

app.listen(port, () => console.log(`My Dinner Pal Backend listening on port ${port}!`))