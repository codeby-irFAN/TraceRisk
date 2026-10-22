# Enable Google sign-in

Google login uses your existing Supabase project. No Google secret belongs in GitHub or the browser. This code adds the button and PKCE flow; dashboard credentials must be configured by the project owner.

1. Complete [Supabase setup](SUPABASE_SETUP.md) first. The Render site must use Supabase mode.
2. Open [Google Cloud Console](https://console.cloud.google.com/), choose/create a project, and configure **Google Auth Platform → Branding / Audience** (older UI: OAuth consent screen). For an external app in testing, add your own Google account under test users.
3. Under **Google Auth Platform → Clients** (older UI: APIs & Services → Credentials), create an **OAuth client ID → Web application**.
4. Set **Authorized redirect URI** to:

   ```text
   https://bpvuolxugcmqqwdplpbo.supabase.co/auth/v1/callback
   ```

   Use this Supabase URL for the Google callback, not the TraceRisk app callback. If the console requests an Authorized JavaScript origin, use `https://tracerisk.onrender.com`.

5. Copy the Google **Client ID** and **Client secret** directly into **Supabase → Authentication → Sign In / Providers → Google**. Enable Google and save. Do not send the secret in chat or put it in Render frontend variables.
6. Keep the Supabase **Site URL** set to `https://tracerisk.onrender.com`, with `https://tracerisk.onrender.com/auth/callback` in the allowed redirect URLs.
7. On TraceRisk, click **Continue with Google**, complete Google's screen and confirm you return signed in. Test with an allowed test account if the Google application is still in testing.

The server checks whether Google is enabled before sending users to the provider, validates the Supabase authorization URL, and stores the PKCE verifier in an HttpOnly cookie. The existing callback exchanges the code into a verified account session. Email/password remains available when Google is not enabled or is unavailable. Google's configuration and any production verification requirements are separate from this repository's tests; no Google account was signed into by automated tests.
