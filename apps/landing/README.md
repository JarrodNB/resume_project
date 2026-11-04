<!-- Description: How to run and build the Careergrind landing page. -->

# Careergrind landing page

The public marketing page. It explains the product with a made-up worked example and links
to `apps/web` to sign up. It is static and makes no API calls.

Run it with the rest of the stack from the repo root:

```bash
docker compose up landing
```

It serves on http://localhost:5174. Production builds need `VITE_APP_URL`, the web app's address, so
sign-up and sign-in links point at it. The build stops if it is missing.
