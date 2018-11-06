'use strict';
const libpostal = require('node-postal'),
      queryString = require('query-string'),
      Twilio = require('twilio'),
      client = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_ACCOUNT_TOKEN),
      { gremlin, gremlinConnection } = require('../shared/db.js'),
      { currentStep } = require('./step.js'),
      sorryMessage = 'We\'re sorry but Liberandum doesn\'t recognize this number. For details visit http://liberandum.org/about.',
      messages = [
        'All right, first we need your full name',
        'Thanks, now we need your full address (street address, apartment/suite, city, state, and zipcode)',
        'How many people live with you?',
        'Do you know anyone you could stay with outside the evacuation area?',
      ];

const twilioHook = async (event, context) => {
  const incoming = queryString.parse(event.body);
  const Graph = gremlin.structure.Graph;
  const graph = new Graph();
  const g = graph.traversal().withRemote(gremlinConnection());

  const user = await g.V()
                        .hasLabel('person')
                        .has('phone_number', incoming.From)
                        .next();

  let msg;
  console.log(user);

  if(!user.value) {
    // we've never seen you before... sorry message
    client
      .messages
      .create({
        body: sorryMessage,
        to: incoming.From,
        from: process.env.TWILIO_ACCOUNT_NUMBER
      });

    console.log({
      statusCode: 200,
      body: JSON.stringify({
        message: '[unknown user]',
        input: { timestamp: new Date(), ...incoming },
      }),
    });
  } else {
    const userValues = await g.V(user.value.id).valueMap().next();
    // we know you
    switch(currentStep(userValues.value)) {
      case 0:
        //opt in
        msg = messages[0];
        g.V(user.value.id)
         .property('opt_in', incoming.Body.toLowerCase().trim() === 'yes')
         .next();
        break;
      case 1:
        // name
        msg = messages[1];
        g.V(user.value.id)
         .property('name', incoming.Body.trim())
         .next();
        break;
      case 2:
        // address
        const address = libpostal.parser.parse_address(incoming.Body.trim());

        address.forEach((i) => {
          g.V(user.value.id)
           .property(i.component, i.value)
           .next();
        });

        g.V(user.value.id)
           .property('country', incoming.FromCountry)
           .next();

        msg = messages[2];
        break;
      case 3:
        msg = messages[3];
        g.V(user.value.id)
         .property('household_size', parseInt(incoming.Body.trim(), 10))
         .next();
        break;
      //TODO: handle optIn False for people who aren't interested
    }

    client
      .messages
      .create({
        body: msg,
        to: incoming.From,
        from: process.env.TWILIO_ACCOUNT_NUMBER
      });

    console.log({
      statusCode: 200,
      body: JSON.stringify({
        message: 'Go Serverless v1.0! Your function executed successfully!',
        input: event,
      }),
    });
  }

  return { statusCode: 204 };
};

module.exports = {
  twilioHook,
  addUser: require('./addUser.js').addUser
};