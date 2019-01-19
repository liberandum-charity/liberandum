// @flow
import type { APIGatewayEvent, Context } from 'flow-aws-lambda';
import type { Response } from '../common-types/response';

const { gremlin, gremlinConnection } = require('../shared/db.js');
const Twilio = require('twilio');
const uuid = require('uuid/v4');
const client = new Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_ACCOUNT_TOKEN
);

const message =
  'You have been invited to liberandum! \n We are working to help people get out of the disaster zone. In order to setup your account we need to ask you a few questions. If interested please respond with YES';

const addUser = async (
  event: APIGatewayEvent | { body: string },
  context?: Context
): Response => {
  const body = event.body ? JSON.parse(event.body) : {};
  const phone = body.phone;
  const suggestingPhone = body.From;
  const Graph = gremlin.structure.Graph;
  const graph = new Graph();
  const g = graph.traversal().withRemote(gremlinConnection());

  const user = await g
    .V()
    .limit(1)
    .hasLabel('person')
    .has('phone_number', phone)
    .toList();

  const suggestor = await g
    .V()
    .limit(1)
    .hasLabel('person')
    .has('phone_number', suggestingPhone)
    .toList();

  if (
    suggestor.length === 0 &&
    event.queryStringParameters &&
    !event.queryStringParameters.bypass
  ) {
    console.log(`unknown number ${suggestingPhone} tried to suggest ${phone}`);
    return { statusCode: 204 };
  }

  if (user.length === 0) {
    // we've never seen you before... add you!
    const p = g
      .addV('person')
      .property('phone_number', phone)
      .property('uuid', uuid())
      .property('invited_by', suggestingPhone)
      .next();

    if (event.queryStringParameters && !event.queryStringParameters.bypass) {
      // add edge
      g.addE('invited')
        .from(suggestor)
        .to(p);
    }

    client.messages.create({
      body: message,
      to: phone,
      from: process.env.TWILIO_ACCOUNT_NUMBER
    });

    console.log({
      statusCode: 200,
      body: JSON.stringify({
        message: '[new user]',
        input: { timestamp: new Date(), ...event }
      })
    });
  } else {
    // we know you
    console.log({
      statusCode: 200,
      body: JSON.stringify({
        message: '[attempted new user for known user]',
        input: { timestamp: new Date(), ...event }
      })
    });
  }

  return { statusCode: 204 };
};

const addUserRoute = async (
  event: APIGatewayEvent,
  context?: Context
): Response => {
  return addUser(event);
};

module.exports = addUserRoute;
