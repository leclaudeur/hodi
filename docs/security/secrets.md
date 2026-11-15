# Secrets

Nothing secret lives in the repository or in environment variables. The server makes its own keys on its first start,
and its database keeps only the secrets that Hodi really needs to work.

## In the data volume

On the first start, the server writes two files into the `hodi-data` volume, readable by its user only (mode `600`):

- **`session-secret`** signs the session cookies, and keys the hashes of one-time codes;
- **`vapid.json`** is the key pair that signs push notifications.

Deleting `session-secret` signs out every device: [Deployment](../deployment.md#sign-out-every-device) shows how.

## In the database

The database holds the password hashes, the sealed two-step secrets and the AI provider's API key. The key is sent
only to its provider, and the admin's page shows only its first characters and last four.

> [!IMPORTANT]
> The backups hold the same database: keep them as private as the volume itself.

[← Back to security](../security.md)
