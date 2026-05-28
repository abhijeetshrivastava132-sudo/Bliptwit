import "../../app.js";
import { getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";

const authInstance = getAuth(getApp());
const googleProvider = new GoogleAuthProvider();

function showLoginLoading(){
  let loader = document.getElementById("google-login-loading");
  if(!loader){
    loader = document.createElement("div");
    loader.id = "google-login-loading";
    loader.innerHTML = `
      <div style="position:fixed;inset:0;z-index:99999;background:rgba(7,9,15,.96);display:flex;align-items:center;justify-content:center;padding:24px;">
        <div style="width:100%;max-width:320px;text-align:center;color:var(--text-primary);">
          <div style="width:54px;height:54px;margin:0 auto 18px;border-radius:50%;border:3px solid rgba(255,255,255,.14);border-top-color:var(--accent-primary);animation:btSpin .8s linear infinite;"></div>
          <div style="font-size:1.08rem;font-weight:700;margin-bottom:6px;">Opening Google...</div>
          <div style="font-size:.86rem;color:var(--text-secondary);line-height:1.5;">Complete sign in from the Google popup.</div>
        </div>
      </div>
    `;
    document.body.appendChild(loader);
  }
  loader.style.display = "block";

  if(!document.getElementById("google-login-loading-style")){
    const style = document.createElement("style");
    style.id = "google-login-loading-style";
    style.textContent = "@keyframes btSpin{to{transform:rotate(360deg)}}";
    document.head.appendChild(style);
  }
}

function hideLoginLoading(){
  const loader = document.getElementById("google-login-loading");
  if(loader) loader.style.display = "none";
}

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
      googleLoginBtn.textContent = "Loading...";
      if(loginError) loginError.textContent = "";
      showLoginLoading();
      await signInWithPopup(authInstance, googleProvider);
    }catch(error){
      if(loginError){
        const code = error?.code || "";
        if(code.includes("popup-closed-by-user")) loginError.textContent = "Google sign-in cancelled";
        else if(code.includes("popup-blocked")) loginError.textContent = "Allow popup for Google login";
        else loginError.textContent = error?.message || "Google login failed";
      }
    }finally{
      hideLoginLoading();
      googleLoginBtn.disabled = false;
      googleLoginBtn.textContent = "Continue with Google";
    }
  }, true);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", setupGoogleOnlyLogin);
}else{
  setupGoogleOnlyLogin();
}
