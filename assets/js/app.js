import "../../app.js";
import { getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

const authInstance = getAuth(getApp());
const googleProvider = new GoogleAuthProvider();

function setupGoogleOnlyLogin(){
  const signupForm = document.getElementById("signup-form");
  const loginForm = document.getElementById("login-form");
  const authToggle = document.querySelector(".auth-toggle");
  const googleLoginBtn = document.getElementById("google-login-btn");
  const googleSignupBtn = document.getElementById("google-signup-btn");
  const loginScreen = document.getElementById("login-screen");
  const loginError = document.getElementById("login-error");

  if(!loginScreen || !loginForm || !googleLoginBtn) return;

  if(authToggle) authToggle.style.display = "none";
  if(signupForm){
    signupForm.classList.add("hidden");
    signupForm.style.display = "none";
  }

  loginForm.classList.remove("hidden");
  loginForm.style.display = "flex";

  const hideItems = loginForm.querySelectorAll(".field-group, .btn-primary, .auth-divider, .auth-note");
  hideItems.forEach(el=>el.style.display = "none");

  if(loginError){
    loginError.textContent = "";
    loginError.style.display = "block";
  }

  googleLoginBtn.textContent = "Continue with Google";
  googleLoginBtn.style.display = "flex";
  googleLoginBtn.style.justifyContent = "center";
  googleLoginBtn.style.alignItems = "center";
  googleLoginBtn.style.minHeight = "52px";
  googleLoginBtn.style.width = "100%";

  if(googleSignupBtn) googleSignupBtn.style.display = "none";

  let headline = document.getElementById("google-only-headline");
  if(!headline){
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

  googleLoginBtn.addEventListener("click", async event=>{
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    try{
      googleLoginBtn.disabled = true;
      googleLoginBtn.textContent = "Opening Google...";
      if(loginError) loginError.textContent = "";
      await signInWithPopup(authInstance, googleProvider);
      googleLoginBtn.textContent = "Continue with Google";
    }catch(error){
      if(loginError){
        const code = error?.code || "";
        loginError.textContent = code.includes("popup-closed-by-user") ? "Google sign-in cancelled" : (error?.message || "Google login failed");
      }
      googleLoginBtn.textContent = "Continue with Google";
    }finally{
      googleLoginBtn.disabled = false;
    }
  }, true);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", setupGoogleOnlyLogin);
}else{
  setupGoogleOnlyLogin();
}
