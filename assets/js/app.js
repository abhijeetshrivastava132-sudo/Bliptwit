import "../../app.js";
import { getApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";

const appInstance = getApp();
const authInstance = getAuth(appInstance);
const dbInstance = getFirestore(appInstance);

function authMessage(error){
  const code = error?.code || "";
  const msg = String(error?.message || "");
  if(code.includes("permission-denied") || msg.includes("Missing or insufficient permissions")) return "Firebase rules update needed for username login/reset.";
  if(code.includes("invalid-email")) return "Enter a valid email.";
  if(code.includes("user-not-found")) return "Account not found.";
  if(code.includes("wrong-password") || code.includes("invalid-credential")) return "Invalid username/email or password.";
  if(code.includes("too-many-requests")) return "Too many attempts. Try again later.";
  return error?.message || "Something went wrong.";
}

function usernameKey(value){
  return String(value || "").trim().toLowerCase();
}

async function resolveLoginEmail(value){
  const cleaned = String(value || "").trim();
  if(!cleaned) throw new Error("Enter username or email.");
  if(cleaned.includes("@")) return cleaned;

  const usernameSnap = await getDoc(doc(dbInstance, "usernames", usernameKey(cleaned)));
  if(!usernameSnap.exists()) throw new Error("Username not found.");

  const uid = usernameSnap.data()?.uid;
  if(!uid) throw new Error("Account data incomplete.");

  const userSnap = await getDoc(doc(dbInstance, "users", uid));
  const email = userSnap.exists() ? userSnap.data()?.email : "";
  if(!email) throw new Error("This username has no email login. Try Google sign-in.");
  return email;
}

async function handleBetterLogin(event){
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const input = document.getElementById("login-username");
  const password = document.getElementById("login-password");
  const errorBox = document.getElementById("login-error");
  const button = document.getElementById("login-submit");

  if(!input || !password || !errorBox) return;
  errorBox.style.color = "";
  errorBox.textContent = "";

  const id = input.value.trim();
  const pass = password.value;
  if(!id){ errorBox.textContent = "Enter username or email."; return; }
  if(!pass){ errorBox.textContent = "Enter password."; return; }

  try{
    if(button){ button.disabled = true; button.textContent = "Signing in..."; }
    const email = await resolveLoginEmail(id);
    await signInWithEmailAndPassword(authInstance, email, pass);
  }catch(error){
    errorBox.textContent = authMessage(error);
  }finally{
    if(button){ button.disabled = false; button.textContent = "Sign In"; }
  }
}

function createResetScreen(){
  let resetScreen = document.getElementById("forgot-reset-screen");
  if(resetScreen) return resetScreen;

  resetScreen = document.createElement("div");
  resetScreen.id = "forgot-reset-screen";
  resetScreen.className = "screen forgot-reset-screen";
  resetScreen.innerHTML = `
    <div class="forgot-reset-card">
      <button class="forgot-back-btn" id="forgot-back-btn" type="button" aria-label="Back to login">←</button>
      <div class="forgot-reset-icon">🔐</div>
      <h2>Reset Password</h2>
      <p class="forgot-reset-sub">Enter your username or email. We'll send a secure password reset link to your registered email.</p>
      <div class="field-group forgot-field-group">
        <label class="field-label">Username or Email</label>
        <div class="input-wrap input-with-icon">
          <span class="field-icon">@</span>
          <input type="text" id="forgot-identity-input" placeholder="Username or email" autocomplete="username" />
        </div>
      </div>
      <div class="error-msg" id="forgot-reset-message"></div>
      <button class="btn-primary" id="forgot-send-btn" type="button">Send Reset Link</button>
      <button class="btn-cancel forgot-login-btn" id="forgot-login-btn" type="button">Back to Login</button>
      <p class="forgot-reset-note">After clicking the email link, set a new password and return to Bliptwit.</p>
    </div>
  `;
  document.getElementById("app")?.appendChild(resetScreen);
  return resetScreen;
}

function showResetScreen(){
  const loginScreen = document.getElementById("login-screen");
  const resetScreen = createResetScreen();
  loginScreen?.classList.remove("active");
  resetScreen.classList.add("active");
  const loginValue = document.getElementById("login-username")?.value?.trim() || "";
  const resetInput = document.getElementById("forgot-identity-input");
  if(resetInput){
    resetInput.value = loginValue;
    setTimeout(()=>resetInput.focus(), 80);
  }
}

function showLoginFromReset(){
  const loginScreen = document.getElementById("login-screen");
  const resetScreen = document.getElementById("forgot-reset-screen");
  resetScreen?.classList.remove("active");
  loginScreen?.classList.add("active");
}

async function handleBetterPasswordReset(){
  const input = document.getElementById("forgot-identity-input") || document.getElementById("login-username");
  const messageBox = document.getElementById("forgot-reset-message") || document.getElementById("login-error");
  const button = document.getElementById("forgot-send-btn");
  if(!input || !messageBox) return;

  messageBox.style.color = "";
  messageBox.textContent = "";
  const id = input.value.trim();
  if(!id){ messageBox.textContent = "Enter your email or username first."; return; }

  try{
    if(button){ button.disabled = true; button.textContent = "Sending..."; }
    const email = await resolveLoginEmail(id);
    await sendPasswordResetEmail(authInstance, email);
    messageBox.style.color = "var(--accent-primary)";
    messageBox.textContent = "Reset link sent. Check Inbox, Promotions, or Spam.";
  }catch(error){
    messageBox.style.color = "";
    messageBox.textContent = authMessage(error);
  }finally{
    if(button){ button.disabled = false; button.textContent = "Send Reset Link"; }
  }
}

function setLoginMode(){
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const title = document.querySelector(".auth-page-title");
  const sub = document.querySelector(".auth-page-sub");
  if(signupForm) signupForm.classList.add("hidden");
  if(loginForm) loginForm.classList.remove("hidden");
  if(title) title.textContent = "Sign in to Bliptwit";
  if(sub) sub.textContent = "Use your username/email and password, or continue with Google.";
}

function setSignupMode(){
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const title = document.querySelector(".auth-page-title");
  const sub = document.querySelector(".auth-page-sub");
  if(loginForm) loginForm.classList.add("hidden");
  if(signupForm) signupForm.classList.remove("hidden");
  if(title) title.textContent = "Create your Bliptwit account";
  if(sub) sub.textContent = "Create an account with email and password, or continue with Google.";
}

function setupImprovedLoginPage(){
  const loginScreen = document.getElementById("login-screen");
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const authToggle = document.querySelector(".auth-toggle");
  const showSignupToggle = document.getElementById("show-signup-toggle");
  const showLoginToggle = document.getElementById("show-login-toggle");
  const loginTitle = document.querySelector(".auth-page-title");
  const loginSub = document.querySelector(".auth-page-sub");
  const loginSubmit = document.getElementById("login-submit");
  const loginUsernameLabel = loginForm?.querySelector(".field-group:first-child .field-label");
  const loginUsernameInput = document.getElementById("login-username");

  if(!loginScreen || !loginForm || !signupForm) return;

  setLoginMode();

  if(authToggle) authToggle.style.display = "none";
  if(loginTitle) loginTitle.textContent = "Sign in to Bliptwit";
  if(loginSub) loginSub.textContent = "Use your username/email and password, or continue with Google.";
  if(loginUsernameLabel) loginUsernameLabel.textContent = "Username or Email";
  if(loginUsernameInput){
    loginUsernameInput.placeholder = "Username or email";
    loginUsernameInput.setAttribute("autocomplete", "username");
  }
  if(loginSubmit) loginSubmit.textContent = "Sign In";

  let linksRow = document.getElementById("login-helper-links-row");
  if(!linksRow && loginSubmit){
    linksRow = document.createElement("div");
    linksRow.id = "login-helper-links-row";
    linksRow.className = "auth-links-row";
    linksRow.innerHTML = `
      <button class="auth-link-btn" id="forgot-password-btn" type="button">Forgot Password?</button>
      <button class="auth-link-btn muted" id="login-new-user-btn" type="button">New user? Sign up</button>
    `;
    loginSubmit.insertAdjacentElement("afterend", linksRow);
  }

  createResetScreen();

  const forgotPasswordBtn = document.getElementById("forgot-password-btn");
  const loginNewUserBtn = document.getElementById("login-new-user-btn");

  loginSubmit?.addEventListener("click", handleBetterLogin, true);
  loginForm?.addEventListener("submit", handleBetterLogin, true);
  forgotPasswordBtn?.addEventListener("click", showResetScreen);
  loginNewUserBtn?.addEventListener("click", setSignupMode);
  showLoginToggle?.addEventListener("click", setLoginMode);
  showSignupToggle?.addEventListener("click", setSignupMode);
  document.getElementById("forgot-send-btn")?.addEventListener("click", handleBetterPasswordReset);
  document.getElementById("forgot-back-btn")?.addEventListener("click", showLoginFromReset);
  document.getElementById("forgot-login-btn")?.addEventListener("click", showLoginFromReset);
  document.getElementById("forgot-identity-input")?.addEventListener("keydown", e=>{
    if(e.key === "Enter") handleBetterPasswordReset();
  });
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", setupImprovedLoginPage);
}else{
  setupImprovedLoginPage();
}
