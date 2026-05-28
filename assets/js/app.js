import "../../app.js";

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

  loginForm.classList.remove("hidden");
  signupForm.classList.add("hidden");

  if(authToggle){
    authToggle.style.display = "none";
  }

  if(loginTitle){
    loginTitle.textContent = "Sign in to Bliptwit";
  }

  if(loginSub){
    loginSub.textContent = "Use your username or email and password, or continue with Google.";
  }

  if(loginUsernameLabel){
    loginUsernameLabel.textContent = "Username or Email";
  }

  if(loginUsernameInput){
    loginUsernameInput.placeholder = "Your username or email";
    loginUsernameInput.setAttribute("autocomplete", "username");
  }

  if(loginSubmit){
    loginSubmit.textContent = "Sign In";
  }

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

  if(forgotPasswordBtn){
    forgotPasswordBtn.onclick = () => {
      const emailOrUsername = loginUsernameInput?.value?.trim() || "";
      const msg = emailOrUsername.includes("@")
        ? `Password reset link feature is not connected yet. Use Firebase reset flow later for ${emailOrUsername}.`
        : "Enter your email first, then use password reset.";
      if(typeof window.showToast === "function") window.showToast(msg);
      else alert(msg);
    };
  }

  if(loginNewUserBtn){
    loginNewUserBtn.onclick = () => {
      loginForm.classList.add("hidden");
      signupForm.classList.remove("hidden");
      if(loginTitle) loginTitle.textContent = "Create your Bliptwit account";
      if(loginSub) loginSub.textContent = "Create an account with email and password, or continue with Google.";
    };
  }

  if(showLoginToggle){
    showLoginToggle.onclick = () => {
      signupForm.classList.add("hidden");
      loginForm.classList.remove("hidden");
      if(loginTitle) loginTitle.textContent = "Sign in to Bliptwit";
      if(loginSub) loginSub.textContent = "Use your username or email and password, or continue with Google.";
    };
  }

  if(showSignupToggle){
    showSignupToggle.onclick = () => {
      loginForm.classList.add("hidden");
      signupForm.classList.remove("hidden");
      if(loginTitle) loginTitle.textContent = "Create your Bliptwit account";
      if(loginSub) loginSub.textContent = "Create an account with email and password, or continue with Google.";
    };
  }
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", setupImprovedLoginPage);
}else{
  setupImprovedLoginPage();
}
