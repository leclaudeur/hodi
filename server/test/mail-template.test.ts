import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type MailFrame, renderMail } from '../mail/template.ts'

const FRAME: MailFrame = {
  linkFallback: 'Le bouton ne marche pas ? Copie ce lien :',
  sentBy: 'Envoyé par Hodi',
  logo: 'https://hodi.example.test',
  address: 'https://hodi.example.test'
}

// The heights of the spacer rows, in order.
const spaces = (html: string) => [...html.matchAll(/<td height="(\d+)"/g)].map(match => Number(match[1]))

describe('the e-mail template', () => {
  it('puts the same space between the same blocks, whatever sends the e-mail', () => {
    const { html } = renderMail(
      {
        eyebrow: 'Créer un foyer',
        title: 'Ton code',
        blocks: [
          { kind: 'text', text: 'Voici le code.' },
          { kind: 'text', text: 'Tape-le sur la page.' },
          { kind: 'code', code: 'K7QM-4RWD' },
          { kind: 'caption', text: 'Valable 30 minutes.' },
          { kind: 'action', label: 'Ouvrir', url: 'https://hodi.example.test/#join=abc' },
          { kind: 'note', text: 'Si tu n’as rien demandé, ignore cet e-mail.' }
        ]
      },
      FRAME,
      'fr'
    )
    // Logo 24, eyebrow 8, title 16; text 16 text, 24 code, 12 caption, 24 button, 32 line 1 then 24 note; card 24.
    assert.deepEqual(spaces(html), [24, 8, 16, 16, 24, 12, 24, 32, 1, 24, 24])
  })

  it('escapes everything but <i>, and keeps the line breaks', () => {
    const { html, text } = renderMail(
      {
        title: 'Un <b>titre</b>',
        blocks: [{ kind: 'text', text: 'Choisis <i>Entrer</i>\n<img src=x onerror=alert(1)> & "voilà"' }]
      },
      FRAME,
      'fr'
    )
    assert.match(html, /Un &lt;b&gt;titre&lt;\/b&gt;<span/)
    assert.match(html, /Choisis <i>Entrer<\/i><br>&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;voilà&quot;/)
    assert.doesNotMatch(html, /<img src=x/)
    assert.equal(
      text,
      'Un <b>titre</b>\n\nChoisis Entrer\n<img src=x onerror=alert(1)> & "voilà"\n\n-- \nEnvoyé par Hodi\nhttps://hodi.example.test'
    )
  })

  it('writes the logo as text when the server has no address, and the rows with their change', () => {
    const { html, text } = renderMail(
      {
        title: 'Du 9 au 15 novembre',
        blocks: [
          {
            kind: 'rows',
            title: 'Serveur',
            rows: [
              { label: 'Visites', value: '412', change: { text: '+12 %', good: true } },
              { label: 'Temps de lecture', value: '61 h', change: { text: '−3 %', good: false } }
            ]
          }
        ]
      },
      { ...FRAME, logo: null, address: null },
      'en'
    )
    assert.doesNotMatch(html, /<img/)
    assert.match(html, />Hodi<span style="color:#c8693a">\.<\/span>/)
    assert.match(html, /color:#6fcf8e">\+12 %/)
    assert.match(html, /color:#e88a7a">−3 %/)
    assert.equal(
      text,
      'Du 9 au 15 novembre\n\nSERVEUR\nVisites: 412 (+12 %)\nTemps de lecture: 61 h (−3 %)\n\n-- \nEnvoyé par Hodi'
    )
  })
})
