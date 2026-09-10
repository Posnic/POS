'use strict';

/*
 * The real nodemailer, not a mock.
 *
 * email.test.js beside this file mocks nodemailer away, which is right for
 * testing our own logic - but it means the library is never loaded, so a
 * breaking change in it cannot fail the build. That is not hypothetical:
 * Dependabot moved nodemailer from 9.1.1 to 10.0.1, a major version, and CI
 * went green without ever constructing a transport.
 *
 * Email is how invoices, receipts and password resets reach customers, and a
 * transport that stops constructing fails at the moment somebody is waiting
 * for a reset link. So this drives the real Email.newTransport() through each
 * of its three branches against the real library.
 *
 * Nothing is sent anywhere. Only jsonTransport is exercised end to end,
 * because it serialises instead of connecting; the other two are constructed,
 * which is where a removed option or a dropped service preset would throw.
 */

const path = require('path');

/* Deliberately NOT jest.mock('nodemailer'): loading the real one is the point. */
const { Email } = require('../../../src/utils/email');

describe('nodemailer transport contract', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  function makeEmail() {
    /* The constructor wants a user and a url; neither affects the transport. */
    return new Email(
      { email: 'shopkeeper@example.com', name: 'Shopkeeper' },
      'https://example.com/reset'
    );
  }

  test('the installed nodemailer is a real module, not a mock', () => {
    const nodemailer = require('nodemailer');
    expect(typeof nodemailer.createTransport).toBe('function');
    /* A mock would have no version on disk. */
    const pkg = require(path.join('nodemailer', 'package.json'));
    expect(typeof pkg.version).toBe('string');
    expect(pkg.version).toMatch(/^\d+\./);
  });

  test('production branch still builds a SendGrid transport', () => {
    process.env.NODE_ENV = 'production';
    process.env.SENDGRID_USERNAME = 'apikey';
    process.env.SENDGRID_PASSWORD = 'not-a-real-key';

    /* A dropped well-known service preset is exactly what a major version
       removes, and it would take live invoice delivery with it. */
    const transport = makeEmail().newTransport();
    expect(transport).toBeTruthy();
    expect(typeof transport.sendMail).toBe('function');
  });

  test('shop SMTP branch accepts the port as the string env gives us', () => {
    process.env.NODE_ENV = 'development';
    process.env.EMAIL_HOST = 'smtp.example.com';
    process.env.EMAIL_PORT = '587';
    process.env.EMAIL_USERNAME = 'shop';
    process.env.EMAIL_PASSWORD = 'secret';
    process.env.EMAIL_SECURE = 'false';

    /* Environment variables are strings. A stricter validator that demands a
       number would reject every shop-configured SMTP server at once. */
    const transport = makeEmail().newTransport();
    expect(transport).toBeTruthy();
    expect(typeof transport.sendMail).toBe('function');
  });

  test('the development fallback actually delivers to JSON', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.EMAIL_HOST;
    delete process.env.EMAIL_PORT;
    delete process.env.EMAIL_USERNAME;
    delete process.env.EMAIL_PASSWORD;

    const transport = makeEmail().newTransport();
    const info = await transport.sendMail({
      from: 'Posnic <no-reply@example.com>',
      to: 'shopkeeper@example.com',
      subject: 'Transport contract',
      text: 'If this serialises, the library still works end to end.',
    });

    /* jsonTransport hands back the message it would have sent, so this proves
       the whole path rather than just the constructor. */
    expect(info).toBeTruthy();
    const message = JSON.parse(info.message);
    expect(message.subject).toBe('Transport contract');
    expect(message.to[0].address).toBe('shopkeeper@example.com');
  });
});
