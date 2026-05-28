import "../../app.js";
import { getApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";

const appInstance = getApp();
const authInstance = getAuth(appInstance);

function authMessage(error){
  const code = error?.code || "";
  if(code.includes("invalid-email")) return "Enter a valid email.";
  if(code.includes("user-not-found")) return "Account not found.";
  if(code.includes("wrong-password") || code.includes("invalid-credential")) return "Invalid email or password.";
  if(code.includes("too-many-requests")) return "Too many attempts. Try again later.";
  return error?.message || "Something went wrong.";
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

  const email = input.value.trim();
  const pass = password.value;
  if(!email){ errorBox.textContent = "Enter your email."; return; }
  if(!email.includes("@")){ errorBox.textContent = "Use your email to sign in. Username login needs Firebase rules update."; return; }
  if(!pass){ errorBox.textContent = "Enter password."; return; }

  try{
    if(button){ button.disabled = true; button.textContent = "Signing in..."; }
    await signInWithEmailAndPassword(authInstance, email, pass);
  }catch(error){
    errorBox.textContent = authMessage(error);
  }finally{
    if(button){ button.disabled = false; button.textContent = "Sign In"; }
  }
}

async function handleBetterPasswordReset(){
  const input = document.getElementById("login-username");
  const errorBox = document.getElementById("login-error");
  if(!input || !errorBox) return;

  errorBox.style.color = "";
  errorBox.textContent = "";
  const email = input.value.trim();
  if(!email){ errorBox.textContent = "Enter your email first."; return; }
  if(!email.includes("@")){ errorBox.textContent = "Enter your email, not username, to reset password."; return; }

  try{
    await sendPasswordResetEmail(authInstance, email);
    errorBox.style.color = "var(--accent-primary)";
    errorBox.textContent = "Password reset link sent. Check inbox/spam.";
    setTimeout(()=>{ errorBox.style.color = ""; }, 4500);
  }catch(error){
    errorBox.style.color = "";
    errorBox.textContent = authMessage(error);
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
  if(sub) sub.textContent = "Use your email and password, or continue with Google.";
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
  if(loginSub) loginSub.textContent = "Use your email and password, or continue with Google.";
  if(loginUsernameLabel) loginUsernameLabel.textContent = "Email";
  if(loginUsernameInput){
    loginUsernameInput.placeholder = "Your email address";
    loginUsernameInput.setAttribute("autocomplete", "email");
    loginUsernameInput.setAttribute("inputmode", "email");
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

  const forgotPasswordBtn = document.getElementById("forgot-password-btn");
  const loginNewUserBtn = document.getElementById("login-new-user-btn");

  loginSubmit?.addEventListener("click", handleBetterLogin, true);
  loginForm?.addEventListener("submit", handleBetterLogin, true);
  forgotPasswordBtn?.addEventListener("click", handleBetterPasswordReset);
  loginNewUserBtn?.addEventListener("click", setSignupMode);
  showLoginToggle?.addEventListener("click", setLoginMode);
  showSignupToggle?.addEventListener("click", setSignupMode);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", setupImprovedLoginPage);
}else{
  setupImprovedLoginPage();
}
