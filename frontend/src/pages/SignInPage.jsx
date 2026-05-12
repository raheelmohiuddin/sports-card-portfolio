import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react";
import { signUp, confirmSignUp, fetchUserAttributes } from "aws-amplify/auth";
import { I18n } from "aws-amplify/utils";

// Override Amplify's auth error messages with a single, friendly message that
// also avoids revealing whether the username exists (prevents user enumeration).
// Cognito returns several distinct strings for the same failure mode — map them all.
I18n.putVocabularies({
  en: {
    "Incorrect username or password.": "Username or password does not exist",
    "Incorrect username or password":  "Username or password does not exist",
    "User does not exist.":            "Username or password does not exist",
    "User does not exist":             "Username or password does not exist",
    "User password cannot be reset in the current state.": "Username or password does not exist",
    "Password attempts exceeded":      "Username or password does not exist",
  },
});

export default function SignInPage() {
  const { authStatus } = useAuthenticator((ctx) => [ctx.authStatus]);
  const navigate = useNavigate();

  // After auth completes, route to setup-username if the user hasn't picked
  // a preferred_username yet (new accounts), otherwise straight to portfolio.
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    fetchUserAttributes()
      .then((attrs) => {
        if (cancelled) return;
        navigate(attrs.preferred_username ? "/portfolio" : "/setup-username", { replace: true });
      })
      .catch(() => {
        if (!cancelled) navigate("/portfolio", { replace: true });
      });
    return () => { cancelled = true; };
  }, [authStatus, navigate]);

  // Hide the auto-rendered Cognito username field on the signup form. We
  // identify "the signup form" as the one containing the given_name field
  // (sign-in only has username + password). handleSignUp populates the
  // hidden username with the email value. MutationObserver catches tab toggles.
  useEffect(() => {
    function hideAutoUsername() {
      document.querySelectorAll("form").forEach((form) => {
        if (!form.querySelector('input[name="given_name"]')) return; // not signup
        const target = form.querySelector('input[name="username"]');
        if (!target || target.dataset.scpHidden === "1") return;
        let el = target.parentElement;
        while (el && el !== form) {
          const cls = typeof el.className === "string" ? el.className : "";
          if (/field/i.test(cls)) {
            el.style.display = "none";
            target.dataset.scpHidden = "1";
            return;
          }
          el = el.parentElement;
        }
        target.style.display = "none";
        const label = target.id && form.querySelector(`label[for="${target.id}"]`);
        if (label) label.style.display = "none";
        target.dataset.scpHidden = "1";
      });
    }
    hideAutoUsername();
    const observer = new MutationObserver(hideAutoUsername);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div style={st.page}>
      <div style={st.top}>
        <span style={st.mark}>◆</span>
        <h1 style={st.title}>Collector's Reserve</h1>
        <p style={st.sub}>Sign in to access your portfolio</p>
      </div>
      <Authenticator formFields={formFields} services={services} />
    </div>
  );
}

// Sign-up form: only First Name, Last Name, Email, Password. Cognito's primary
// `username` field is auto-rendered (because signInAliases.username = true)
// but we hide it via CSS + the JS observer below; handleSignUp populates it
// from the user's email. `preferred_username` is set later on the
// UsernameSetupPage via updateUserAttributes — Cognito refuses to accept
// alias attributes during signUp ("cannot be provided for unconfirmed account").
const formFields = {
  signUp: {
    given_name:       { order: 1, label: "First Name", placeholder: "First name", isRequired: true },
    family_name:      { order: 2, label: "Last Name",  placeholder: "Last name",  isRequired: true },
    email:            { order: 3 },
    password:         { order: 4 },
    confirm_password: { order: 5 },
    // Hidden — auto-rendered because of signInAliases.username; we provide
    // the value via handleSignUp using the user's email.
    username:         { order: 99, isRequired: false, label: "", placeholder: "" },
  },
  signIn: {
    username: {
      label: "Email or Username",
      placeholder: "Email or username",
    },
  },
};

// Generate a stable opaque value for Cognito's primary username field. We
// avoid using the email here because Cognito treats email-formatted
// usernames specially in some flows ("Username cannot be of email format")
// and we want the primary username to be an internal identifier the user
// never sees — they sign in with email or preferred_username (alias).
function generatePrimaryUsername() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `u-${crypto.randomUUID()}`;
  }
  // Older browser fallback
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Bridge the generated UUID across the signUp → confirmSignUp boundary.
// Amplify's internal state tracks "username" from form input (which is the
// hidden username field in our case), but signUp was called with a UUID we
// generated. confirmSignUp needs that same UUID to find the unconfirmed
// account. sessionStorage survives a page reload during confirmation but
// gets cleaned up once the account is confirmed.
const SIGNUP_USERNAME_KEY = "scp.signupUsername";

function rememberSignupUsername(username) {
  try { sessionStorage.setItem(SIGNUP_USERNAME_KEY, username); } catch {}
}
function recallSignupUsername() {
  try { return sessionStorage.getItem(SIGNUP_USERNAME_KEY); } catch { return null; }
}
function forgetSignupUsername() {
  try { sessionStorage.removeItem(SIGNUP_USERNAME_KEY); } catch {}
}

const services = {
  async handleSignUp(input) {
    // preferred_username is intentionally omitted here — Cognito refuses
    // alias attributes during signUp ("cannot be provided for unconfirmed
    // account"). It's set post-confirmation on UsernameSetupPage.
    const username = generatePrimaryUsername();
    rememberSignupUsername(username);

    // Defensively normalise the userAttributes so we never spread away
    // given_name / family_name. Amplify v6's Authenticator should put them
    // under input.options.userAttributes, but some Authenticator versions
    // place form-field values at the top level of `input` instead. We pick
    // up both shapes and merge so signUp always receives the Cognito-required
    // attributes (given_name, family_name, email).
    const fromOptions = input?.options?.userAttributes ?? {};
    const fromTopLevel = {};
    for (const k of ["email", "given_name", "family_name", "name"]) {
      if (input?.[k] != null) fromTopLevel[k] = input[k];
    }
    const userAttributes = {
      ...fromTopLevel,
      ...fromOptions,
    };

    if (!userAttributes.given_name || !userAttributes.family_name) {
      console.error("handleSignUp: given_name/family_name missing from input", {
        userAttributesKeys: Object.keys(userAttributes),
      });
    }

    return signUp({
      username,
      password: input.password,
      options: {
        ...(input?.options ?? {}),
        userAttributes,
      },
    });
  },
  async handleConfirmSignUp(input) {
    const stored = recallSignupUsername();
    const result = await confirmSignUp({ ...input, username: stored || input.username });
    // Once the account is confirmed, the bridge value is no longer needed.
    if (result?.isSignUpComplete) forgetSignupUsername();
    return result;
  },
};

const st = {
  page: {
    minHeight: "calc(100vh - 60px)",
    background: "linear-gradient(160deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)",
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    padding: "3rem 1rem",
    gap: "2rem",
  },
  top: { textAlign: "center" },
  mark: { color: "#f59e0b", fontSize: "1.5rem", display: "block", marginBottom: "0.5rem" },
  title: { color: "#fff", fontSize: "1.6rem", fontWeight: 800, margin: 0, letterSpacing: "-0.02em" },
  sub: { color: "#64748b", fontSize: "0.9rem", marginTop: "0.4rem" },
};
