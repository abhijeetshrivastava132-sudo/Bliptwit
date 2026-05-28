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

  if(!document.getElementById("google-login-style")){
    const style = document.createElement("style");
    style.id = "google-login-style";
    style.textContent = `
      @keyframes btSpin{to{transform:rotate(360deg)}}
      #login-screen{
        justify-content:flex-start !important;
        padding:calc(var(--safe-top) + 34px) 20px calc(var(--safe-bottom) + 24px) !important;
        background:
          radial-gradient(circle at 50% -10%, rgba(0,201,167,.22), transparent 34%),
          radial-gradient(circle at 0% 35%, rgba(0,150,255,.12), transparent 32%),
          var(--bg-deep) !important;
      }
      #login-screen .login-logo-wrap{margin-bottom:22px !important;}
      #login-screen .login-logo-icon{
        width:72px !important;height:72px !important;border-radius:24px !important;
        box-shadow:0 22px 54px rgba(0,201,167,.18) !important;
        animation:none !important;
      }
      #login-screen .login-logo-text{font-size:1.65rem !important;font-weight:800 !important;letter-spacing:-.05em !important;}
      #login-screen .login-logo-sub{font-size:.82rem !important;color:var(--text-muted) !important;}
      #login-form{
        max-width:390px;margin:0 auto;padding:22px 18px 18px !important;
        border:1px solid rgba(255,255,255,.08);border-radius:28px;
        background:linear-gradient(180deg, rgba(255,255,255,.075), rgba(255,255,255,.035));
        box-shadow:0 28px 80px rgba(0,0,0,.28);
        backdrop-filter:blur(18px);
        gap:14px !important;
      }
      .google-only-badge{
        display:inline-flex;align-items:center;gap:7px;margin-bottom:16px;padding:7px 11px;border-radius:999px;
        background:rgba(0,201,167,.10);border:1px solid rgba(0,201,167,.18);color:var(--accent-primary);
        font-size:.74rem;font-weight:700;letter-spacing:.02em;
      }
      #google-login-btn{
        border-radius:17px !important;background:#fff !important;color:#151923 !important;
        border:0 !important;font-weight:800 !important;letter-spacing:-.01em !important;
        box-shadow:0 16px 34px rgba(0,0,0,.20) !important;
      }
      #google-login-btn:active{transform:scale(.985);}
      .google-only-footnote{margin-top:2px;text-align:center;color:var(--text-secondary);font-size:.76rem;line-height:1.5;}
    `;
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

  googleLoginBtn.innerHTML = `
    <span style="width:20px;height:20px;display:inline-flex;margin-right:10px;align-items:center;justify-content:center;">
      <svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.1 0 9.8-2 13.3-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.2 5.2C36.9 39.1 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
    </span>
    Continue with Google
  `;
  googleLoginBtn.style.display = "flex";
  googleLoginBtn.style.justifyContent = "center";
  googleLoginBtn.style.alignItems = "center";
  googleLoginBtn.style.minHeight = "54px";
  googleLoginBtn.style.width = "100%";

  if(googleSignupBtn) googleSignupBtn.style.display = "none";

  let headline = document.getElementById("google-only-headline");
  if(!headline){
    headline = document.createElement("div");
    headline.id = "google-only-headline";
    headline.innerHTML = `
      <div style="text-align:center;margin-bottom:18px;">
        <div class="google-only-badge">● Private beta access</div>
        <h2 style="margin:0 0 9px;font-size:1.55rem;letter-spacing:-.055em;line-height:1.08;">Welcome to Bliptwit</h2>
        <p style="margin:0 auto;color:var(--text-muted);font-size:.9rem;line-height:1.55;max-width:280px;">Fast, private chats. Sign in securely with Google and start in seconds.</p>
      </div>
    `;
    loginForm.insertBefore(headline, loginForm.firstChild);
  }

  let footnote = document.getElementById("google-only-footnote");
  if(!footnote){
    footnote = document.createElement("div");
    footnote.id = "google-only-footnote";
    footnote.className = "google-only-footnote";
    footnote.textContent = "No password. No reset headache. Your Google account stays private.";
    googleLoginBtn.insertAdjacentElement("afterend", footnote);
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
      googleLoginBtn.innerHTML = `
        <span style="width:20px;height:20px;display:inline-flex;margin-right:10px;align-items:center;justify-content:center;">
          <svg viewBox="0 0 48 48" width="20" height="20"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.1 0 9.8-2 13.3-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.2 5.2C36.9 39.1 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        </span>
        Continue with Google
      `;
    }
  }, true);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", setupGoogleOnlyLogin);
}else{
  setupGoogleOnlyLogin();
}
