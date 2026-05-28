import { getApp } from "firebase/app";
import { getAuth, updateProfile } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

function key(value){
  return String(value || "").trim().toLowerCase();
}

function validate(value){
  const name = String(value || "").trim();
  if(name.length < 3) return "Username must be at least 3 characters.";
  if(name.length > 24) return "Username must be under 24 characters.";
  if(!/^[a-zA-Z0-9_]+$/.test(name)) return "Use letters, numbers, and underscore only.";
  return "";
}

function toast(message, type = "success"){
  const el = document.getElementById("toast");
  if(!el) return;
  el.textContent = message;
  el.className = `show ${type === "error" ? "error-toast" : "success-toast"}`;
  setTimeout(()=>el.classList.remove("show"), 2200);
}

function updateLocal(oldName, newName){
  localStorage.setItem("bt_current_user_v3", newName);
  try{
    const users = JSON.parse(localStorage.getItem("bt_users_v3_hashed") || "{}");
    const oldKey = key(oldName);
    const newKey = key(newName);
    if(users[oldKey]){
      users[newKey] = {...users[oldKey], username:newName};
      delete users[oldKey];
      localStorage.setItem("bt_users_v3_hashed", JSON.stringify(users));
    }
  }catch{}

  const menuName = document.getElementById("menu-username");
  if(menuName) menuName.textContent = newName;
  const avatar = document.getElementById("menu-avatar-letter");
  if(avatar) avatar.textContent = newName[0]?.toUpperCase() || "?";
}

async function handleChangeUsername(event){
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const input = document.getElementById("new-username-input");
  const error = document.getElementById("username-change-error");
  const button = document.getElementById("confirm-username-btn");
  const user = auth.currentUser;

  if(error) error.textContent = "";

  const newName = input?.value?.trim() || "";
  const validation = validate(newName);
  if(validation){ if(error) error.textContent = validation; return; }
  if(!user){ if(error) error.textContent = "Please login again."; return; }

  const oldName = localStorage.getItem("bt_current_user_v3") || document.getElementById("menu-username")?.textContent || user.displayName || "";
  const oldKey = key(oldName);
  const newKey = key(newName);
  if(newKey === oldKey){ if(error) error.textContent = "Same as current username"; return; }

  try{
    if(button){ button.disabled = true; button.textContent = "Updating..."; }

    const taken = await getDoc(doc(db, "usernames", newKey));
    if(taken.exists() && taken.data()?.uid !== user.uid){
      throw new Error("Username already taken");
    }

    await setDoc(doc(db, "usernames", newKey), {
      uid: user.uid,
      username: newName,
      usernameLower: newKey,
      updatedAt: serverTimestamp()
    }, {merge:true});

    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid,
      username: newName,
      usernameLower: newKey,
      email: user.email || "",
      photoURL: user.photoURL || "",
      updatedAt: serverTimestamp()
    }, {merge:true});

    if(oldKey && oldKey !== newKey){
      await deleteDoc(doc(db, "usernames", oldKey)).catch(()=>{});
    }

    await updateProfile(user, {displayName:newName}).catch(()=>{});
    updateLocal(oldName, newName);

    document.getElementById("change-username-modal")?.classList.remove("open");
    toast("Username updated", "success");
    setTimeout(()=>window.location.reload(), 500);
  }catch(err){
    if(error) error.textContent = err?.message || "Could not update username";
  }finally{
    if(button){ button.disabled = false; button.textContent = "Update"; }
  }
}

function install(){
  const button = document.getElementById("confirm-username-btn");
  if(!button || button.dataset.usernameFirebaseFix === "1") return;
  button.dataset.usernameFirebaseFix = "1";
  button.addEventListener("click", handleChangeUsername, true);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", install);
}else{
  install();
}
