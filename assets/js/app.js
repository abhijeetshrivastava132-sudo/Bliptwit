import "../../app.js";

function setupGoogleOnlyLogin(){
  const signupForm = document.getElementById("signup-form");
  const loginForm = document.getElementById("login-form");
  const authToggle = document.querySelector(".auth-toggle");
  const googleLoginBtn = document.getElementById("google-login-btn");
  const googleSignupBtn = document.getElementById("google-signup-btn");
  const loginScreen = document.getElementById("login-screen");

  if(!loginScreen) return;

  if(authToggle) authToggle.style.display = "none";
  if(signupForm) signupForm.style.display = "none";
  if(loginForm) loginForm.style.display = "flex";

  const loginFields = loginForm?.querySelectorAll(".field-group, .error-msg, .btn-primary, .auth-divider, .auth-note");
  loginFields?.forEach(el=>{
    if(el.id !== "login-error") el.style.display = "none";
  });

  if(googleLoginBtn){
    googleLoginBtn.textContent = "Continue with Google";
    googleLoginBtn.style.display = "flex";
    googleLoginBtn.style.justifyContent = "center";
    googleLoginBtn.style.minHeight = "52px";
  }

  if(googleSignupBtn){
    googleSignupBtn.style.display = "none";
  }

  let headline = document.getElementById("google-only-headline");
  if(!headline && loginForm){
    headline = document.createElement("div");
    headline.id = "google-only-headline";
    headline.innerHTML = `
      <div style="text-align:center;margin-bottom:18px;">
        <h2 style="margin:0 0 8px;font-size:1.35rem;letter-spacing:-.03em;">Sign in to Bliptwit</h2>
        <p style="margin:0;color:var(--text-secondary);font-size:.88rem;line-height:1.5;">Use Google to continue. No password needed.</p>
      </div>
    `;
    loginForm.insertBefore(headline, loginForm.firstChild);
  }
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", setupGoogleOnlyLogin);
}else{
  setupGoogleOnlyLogin();
}
