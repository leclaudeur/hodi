# Outgoing requests

Hodi fetches news on behalf of its users, so it must never become a proxy to any address. Every request it sends
follows the same rules.

## Where requests go

- **Feeds** come from `sources.yml`, whose feeds must use HTTPS, and from links that profiles add.
- **Added links** go through an SSRF guard: no private, loopback or link-local address.
- **Articles** open in the reader only when a feed listed them: the API takes an item id, never a URL.
- **AI requests** go only to the chosen provider, and only after a click.
- **Plugins** come from the list of Hodi's registry on GitHub. A file is downloaded only from its plugin's GitHub
  release, and installed only when its sha256 is the one the registry gives.

## Checks on every request

- **Public addresses only**: a name must resolve only to public addresses, for the request and each of its redirects.
- **The source's own domains**: an article's address, and its final one, must be on the source's `domains`.
- **Limits**: a 5-second timeout and a 5 MB size cap.

A news site that redirects to the server's own network, such as a router or a cloud metadata address, gets no request.
A redirect to a login or paywall page leaves the source's domains, so the article is marked unreadable.

## Articles

Articles are extracted with Readability on the server, then sanitized again in the browser before they are shown.

[← Back to security](../security.md)
