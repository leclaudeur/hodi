import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MailSettings } from '../db/mail-settings-store.ts'
import type { MailMessage } from '../mail/mailer.ts'
import { PLUGIN_MAILS_PER_HOUR, pluginMailMessage, pluginMailer } from '../plugins/mail.ts'

const SETTINGS: MailSettings = {
  host: 'smtp.example.test',
  port: 587,
  security: 'starttls',
  user: null,
  password: null,
  sender: 'hodi@example.test',
  appUrl: 'https://hodi.example.test',
  updatedAt: 0
}
const PLUGIN = { id: 'village', name: 'Village' }
const MESSAGE = { to: 'marie@example.test', subject: 'Ta place est prête', text: 'Bonjour Marie,\n\nTu peux entrer.' }

describe('e-mails of plugins', () => {
  it('take one plain address, a one-line subject and plain text', () => {
    assert.deepEqual(pluginMailMessage(MESSAGE), MESSAGE)
    // Anything else the plugin adds is left behind.
    assert.deepEqual(pluginMailMessage({ ...MESSAGE, html: '<b>x</b>', from: 'x@example.test' }), MESSAGE)
    for (const refused of [
      null,
      'marie@example.test',
      { ...MESSAGE, to: 'marie@example.test, paul@example.test' },
      { ...MESSAGE, to: ['marie@example.test'] },
      { ...MESSAGE, to: '"Marie" <marie@example.test>' },
      { ...MESSAGE, to: 'marie@example.test\r\nBcc: paul@example.test' },
      { ...MESSAGE, to: 'marie' },
      { ...MESSAGE, subject: 'Salut\r\nFrom: banque@example.test' },
      { ...MESSAGE, subject: 'Salut\nBcc: paul@example.test' },
      { ...MESSAGE, subject: '' },
      { ...MESSAGE, subject: 'x'.repeat(201) },
      { ...MESSAGE, text: 'x'.repeat(20_001) },
      { ...MESSAGE, text: 'a\u0000b' }
    ]) {
      assert.equal(pluginMailMessage(refused), null, JSON.stringify(refused))
    }
  })

  it('are refused until Serveur › E-mail is set up', async () => {
    const mailer = pluginMailer({ store: { get: () => null }, send: async () => {} })
    assert.equal(mailer.available(), false)
    assert.equal(mailer.appUrl(), null)
    await assert.rejects(mailer.send(PLUGIN, MESSAGE), /mail_unavailable/)
  })

  it('end with the core’s footer, in the recipient’s language', async () => {
    const sent: MailMessage[] = []
    const send = async (_settings: MailSettings, message: MailMessage) => {
      sent.push(message)
    }
    await pluginMailer({ store: { get: () => SETTINGS }, send }).send(PLUGIN, MESSAGE)
    assert.equal(pluginMailer({ store: { get: () => SETTINGS }, send }).appUrl(), 'https://hodi.example.test')
    await pluginMailer({ store: { get: () => ({ ...SETTINGS, appUrl: null }) }, send, languageOf: () => 'en' }).send(
      PLUGIN,
      MESSAGE
    )
    assert.deepEqual(sent, [
      {
        to: 'marie@example.test',
        subject: 'Ta place est prête',
        text: 'Bonjour Marie,\n\nTu peux entrer.\n\n-- \nEnvoyé par le plugin Village de Hodi, https://hodi.example.test'
      },
      {
        to: 'marie@example.test',
        subject: 'Ta place est prête',
        text: 'Bonjour Marie,\n\nTu peux entrer.\n\n-- \nSent by the Hodi plugin Village'
      }
    ])
  })

  it('stop at 50 an hour for each plugin, and start again an hour later', async () => {
    let now = 0
    const lines: string[] = []
    let sent = 0
    const mailer = pluginMailer({
      store: { get: () => SETTINGS },
      send: async () => {
        sent += 1
      },
      now: () => now,
      log: line => lines.push(line)
    })
    for (let n = 0; n < PLUGIN_MAILS_PER_HOUR; n++) await mailer.send(PLUGIN, MESSAGE)
    await assert.rejects(mailer.send(PLUGIN, MESSAGE), /mail_limit/)
    await assert.rejects(mailer.send(PLUGIN, MESSAGE), /mail_limit/)
    assert.equal(lines.length, 1)
    // Another plugin has its own 50.
    await mailer.send({ id: 'other', name: 'Other' }, MESSAGE)
    now = 60 * 60 * 1000
    await mailer.send(PLUGIN, MESSAGE)
    assert.equal(sent, PLUGIN_MAILS_PER_HOUR + 2)
  })

  it('count a send that fails, and tell the plugin only that it failed', async () => {
    const lines: string[] = []
    const mailer = pluginMailer({
      store: { get: () => SETTINGS },
      send: async () => {
        throw new Error('mail auth')
      },
      log: line => lines.push(line)
    })
    await assert.rejects(mailer.send(PLUGIN, MESSAGE), /^Error: mail_failed$/)
    assert.deepEqual(lines, ['[plugin village] e-mail not sent: mail auth'])
  })
})
