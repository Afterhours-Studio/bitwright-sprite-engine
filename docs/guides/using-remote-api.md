# Using a remote API

How to generate through a hosted endpoint instead of a local GPU, and what
leaves your machine when you do.

The remote backend is the option for a machine with no usable GPU: an Intel
Mac, a laptop with integrated graphics, or a desktop where several gigabytes of
model weights are unwelcome.

## What leaves the machine

When the remote engine is selected, each generation sends your prompt, your
negative prompt, and the generation parameters to the endpoint you configured.

- The request goes directly from your machine to that endpoint. It is not
  proxied through Afterhours Studio, and Afterhours Studio operates no
  inference service.
- The provider's terms of service and privacy policy govern the request. Read
  them, particularly if the prompts are commercially sensitive.
- Bitwright sends no telemetry of its own, on this backend or any other.

If prompts must not leave the machine, use a local engine. See
[Choosing a backend](choosing-a-backend.md).

## Configuring

Open **Settings**, then **Remote API**.

| Field | Value |
| --- | --- |
| Endpoint | The base URL of the service, for example `https://api.example.com` |
| API key | The key the provider issued |
| Timeout | Seconds to wait for a response. Default 120 |

Press **Use this engine** under **Remote API** once both fields are filled in.
The engine stays unavailable while either is empty, with `Set an endpoint in
Settings` or `Set an API key in Settings` as the reason.

Settings can also be supplied through the environment, which is useful in a
scripted setup:

```bash
export BITWRIGHT_REMOTE_ENDPOINT="https://api.example.com"
export BITWRIGHT_REMOTE_API_KEY="your-key"
export BITWRIGHT_REMOTE_TIMEOUT_S=180
```

See [Configuration](../reference/configuration.md) for the full list.

## Where the key is stored

The API key is held in the engine's settings for the running process. Prefer
the environment variable on a shared machine, and treat the key as you would
any other credential: it is not encrypted at rest in this release.

## What the remote backend supports

| Capability | Supported |
| --- | --- |
| Batch | Yes |
| Style adapters | No |
| Pose control | No |
| Reference image | No |

Only batching is declared, because adapter support varies between providers and
cannot be assumed. The Generate screen disables the rest while this engine is
selected, so an unsupported option is never offered.

A future release will query the provider's own capability endpoint and declare
what it actually offers.

## Errors

| Message | Cause |
| --- | --- |
| Set an endpoint in Settings | The endpoint field is empty |
| Set an API key in Settings | The key field is empty |
| The remote API rejected the request or could not be reached | Network failure, a rejected key, or a provider error |

Availability is not probed over the network, because the Settings screen asks
for it on every render and a round trip there would make the screen sluggish. A
dead endpoint therefore surfaces at generation time rather than in the engine
list.

## Cost

Every image is billed by the provider. Batch size multiplies that: a batch of
eight is eight images. Check the provider's pricing before running a large
batch.
