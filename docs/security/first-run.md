# First run

A fresh install has no account yet, so the first person who reaches it could claim it for themselves. Hodi closes that
window in three ways, from the server's first start until the household is set up.

## Until the setup is done

Every API route except the setup screens' answers `setup_required`, and sign-in is refused. The rest of the app stays
closed until the household exists, so a stranger can neither see nor change anything.

## The setup code

A browser that reaches the server through a reverse proxy, or from a public address, must first type the setup code.
The server prints it in its log at each start: 8 characters of the codes' alphabet, about 40 bits, compared in
constant time. On the machine itself or on a private network, the code is not asked. [Deployment](../deployment.md#the-setup-code)
shows how to read it.

A request counts as remote when it carries `X-Forwarded-For`, `X-Real-IP` or `Forwarded`. A wrong code counts against
the [sign-in throttle](sign-in.md#throttling), just as a wrong password does, so guessing it is slow.

> [!WARNING]
> A proxy or tunnel that adds none of these headers makes every visitor look local: a plain TCP relay such as
> `ssh -R` or socat, or a misconfigured proxy. Finish the setup before you open access through one.

## A setup that runs once

_Account_ is refused once an account exists, and _Your household_ once the household is set up. The household's step
needs the server admin's session, which stands for the setup code from then on.

[← Back to security](../security.md)
