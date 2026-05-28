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
          <div style="width:46px;height:46px;margin:0 auto 18px;border-radius:50%;border:3px solid rgba(255,255,255,.14);border-top-color:var(--accent-primary);animation:btSpin .8s linear infinite;"></div>
          <div style="font-size:1.02rem;font-weight:650;margin-bottom:6px;">Opening Google</div>
          <div style="font-size:.84rem;color:var(--text-secondary);line-height:1.5;">Continue in the sign-in window.</div>
        </div>
      </div>
    `;
    document.body.appendChild(loader);
  }
  loader.style.display = "block";

  if(!document.getElementById("google-login-style")){
    const style = document.createElement("style");
    style.id = "google-login-style";
    style.textContent = `
      @keyframes btSpin{to{transform:rotate(360deg)}}
      #login-screen{
        justify-content:center !important;
        padding:calc(var(--safe-top) + 28px) 20px calc(var(--safe-bottom) + 24px) !important;
        background:
          radial-gradient(circle at 50% -12%, rgba(255,255,255,.08), transparent 28%),
          radial-gradient(circle at 50% 110%, rgba(0,201,167,.10), transparent 30%),
          #07090f !important;
      }
      #login-screen .login-logo-wrap{margin-bottom:24px !important;}
      #login-screen .login-logo-icon{
        width:68px !important;height:68px !important;border-radius:22px !important;
        background:linear-gradient(135deg, #00c9a7, #0096ff) !important;
        box-shadow:0 18px 42px rgba(0,201,167,.16) !important;
        animation:none !important;
      }
      #login-screen .login-logo-icon svg{width:34px !important;height:34px !important;}
      #login-screen .login-logo-text{font-size:1.72rem !important;font-weight:800 !important;letter-spacing:-.055em !important;}
      #login-screen .login-logo-sub{font-size:.82rem !important;color:var(--text-muted) !important;margin-top:6px !important;}
      #login-form{
        max-width:388px;margin:0 auto;padding:22px 18px 18px !important;
        border:1px solid rgba(255,255,255,.085);border-radius:26px;
        background:rgba(255,255,255,.055);
        box-shadow:0 26px 76px rgba(0,0,0,.34);
        backdrop-filter:blur(18px);
        gap:4px !important;
      }
      #google-login-btn{
        min-height:54px !important;width:100% !important;border-radius:16px !important;
        background:#ffffff !important;color:#111827 !important;border:1px solid rgba(255,255,255,.9) !important;
        font-weight:700 !important;font-size:.96rem !important;letter-spacing:-.01em !important;
        box-shadow:0 14px 32px rgba(0,0,0,.22) !important;
        transition:transform .16s ease, opacity .16s ease !important;
      }
      #google-login-btn:active{transform:scale(.985);}
      #google-login-btn:disabled{opacity:.72;}
      #login-error{min-height:18px;font-size:.8rem;color:var(--danger) !important;}
      .google-only-footer{margin-top:4px;text-align:center;color:var(--text-secondary);font-size:.75rem;line-height:1.5;}
    `;
    document.head.appendChild(style);
  }
}

function hideLoginLoading(){
  const loader = document.getElementById("google-login-loading");
  if(loader) loader.style.display = "none";
}

function googleButtonMarkup(){
  return `
    <span style="width:20px;height:20px;display:inline-flex;margin-right:10px;align-items:center;justify-content:center;flex:0 0 auto;">
      <svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.1 0 9.8-2 13.3-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.2 5.2C36.9 39.1 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
    </span>
    Continue with Google
  `;
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

  showLoginLoading();
  hideLoginLoading();

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
    loginError.style.textAlign = "center";
  }

  googleLoginBtn.innerHTML = googleButtonMarkup();
  googleLoginBtn.style.display = "flex";
  googleLoginBtn.style.justifyContent = "center";
  googleLoginBtn.style.alignItems = "center";

  if(googleSignupBtn) googleSignupBtn.style.display = "none";

  let headline = document.getElementById("google-only-headline");
  const headlineHtml = `
    <div style="text-align:center;margin-bottom:2px;">
      <h2 style="margin:0 0 6px;font-size:1.5rem;letter-spacing:-.045em;line-height:1.12;">Sign in to Bliptwit</h2>
      <p style="margin:0 auto;color:var(--text-muted);font-size:.9rem;line-height:1.5;max-width:284px;">Continue to your account and start messaging securely.</p>
    </div>
  `;
  if(!headline){
    headline = document.createElement("div");
    headline.id = "google-only-headline";
    headline.innerHTML = headlineHtml;
    loginForm.insertBefore(headline, loginForm.firstChild);
  }else{
    headline.innerHTML = headlineHtml;
  }

  let oldFootnote = document.getElementById("google-only-footnote");
  if(oldFootnote) oldFootnote.remove();

  let footer = document.getElementById("google-only-footer");
  if(!footer){
    footer = document.createElement("div");
    footer.id = "google-only-footer";
    footer.className = "google-only-footer";
    footer.textContent = "Secure sign-in powered by Google";
    googleLoginBtn.insertAdjacentElement("afterend", footer);
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
      googleLoginBtn.innerHTML = googleButtonMarkup();
    }
  }, true);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", setupGoogleOnlyLogin);
}else{
  setupGoogleOnlyLogin();
}
