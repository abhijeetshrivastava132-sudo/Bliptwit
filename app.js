import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, query, orderBy, where,
  onSnapshot, addDoc, serverTimestamp,
  doc, setDoc, updateDoc, deleteDoc, deleteField, getDocs, getDoc, limit
} from "firebase/firestore";
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut, updateProfile, deleteUser, setPersistence, browserLocalPersistence
} from "firebase/auth";

const firebaseConfig = {
  apiKey:"AIzaSyDAVeaPTVyLaj5CxpS8M0_KouA6ZepUUSg",
  authDomain:"bliptwit.firebaseapp.com",
  projectId:"bliptwit",
  storageBucket:"bliptwit.firebasestorage.app",
  messagingSenderId:"644935244780",
  appId:"1:644935244780:web:8749150895dcd105977ec9"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
setPersistence(auth, browserLocalPersistence).catch(()=>{});

async function hashPassword(p) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode('bliptwit_salt_v1_'+p.length+p));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function verifyPassword(p,h){ return (await hashPassword(p))===h; }

const USERS_KEY='bt_users_v3_hashed',CURRENT_USER_KEY='bt_current_user_v3',CHATS_KEY='bt_chats_v4',BLOCK_KEY='bt_blocked_v3';
const DISAPPEAR_SETTINGS_KEY='bt_disappear_settings_v1';
const CHAT_KEYS_KEY='bt_chat_keys_v1';
const E2EE_ENABLED=true;
let currentUserUid=null;

function scopedStorageKey(baseKey){
  return currentUserUid?`${baseKey}_${currentUserUid}`:baseKey;
}

const loadUsers=()=>{ try{return JSON.parse(localStorage.getItem(USERS_KEY)||'{}')}catch{return{}} };
const saveUsers=u=>localStorage.setItem(USERS_KEY,JSON.stringify(u));
const getCurrentUser=()=>localStorage.getItem(CURRENT_USER_KEY);
const setCurrentUser=u=>u?localStorage.setItem(CURRENT_USER_KEY,u):localStorage.removeItem(CURRENT_USER_KEY);
const loadChats=()=>{ try{return JSON.parse(localStorage.getItem(scopedStorageKey(CHATS_KEY))||'[]')}catch{return[]} };
const saveChats=c=>localStorage.setItem(scopedStorageKey(CHATS_KEY),JSON.stringify(c));
const loadBlocked=()=>{ try{return JSON.parse(localStorage.getItem(scopedStorageKey(BLOCK_KEY))||'[]')}catch{return[]} };
const saveBlocked=b=>localStorage.setItem(scopedStorageKey(BLOCK_KEY),JSON.stringify(b));

const AUTO_DELETE_MODES={
  never:{label:'Never',delayMs:null},
  after_viewing:{label:'After viewing',delayMs:0},
  '1_hour_after_viewing':{label:'1 hour after viewing',delayMs:60*60*1000},
  '24_hours_after_viewing':{label:'24 hours after viewing',delayMs:24*60*60*1000},
  '7_days_after_viewing':{label:'7 days after viewing',delayMs:7*24*60*60*1000}
};
function normalizeAutoDeleteMode(mode){
  return AUTO_DELETE_MODES[mode]?mode:null;
}
function getAutoDeleteLabel(mode){
  return AUTO_DELETE_MODES[mode]?.label||'Off';
}
function getRoomAutoDelete(roomId=activeChatId){
  if(!roomId) return null;
  let mode=null;
  if(activeChat?.roomId===roomId) mode=normalizeAutoDeleteMode(activeChat.autoDelete?.mode||activeChat.autoDeleteMode);
  else {
    const chat=chats.find(c=>c.roomId===roomId);
    mode=normalizeAutoDeleteMode(chat?.autoDelete?.mode||chat?.autoDeleteMode);
  }
  return mode==='never'?null:mode;
}
function getMessageAutoDeleteFields(roomId){
  const mode=getRoomAutoDelete(roomId);
  return mode?{
    autoDeleteMode:mode,
    viewedBy:{},
    viewedAtBy:{},
    expiresAtBy:{},
    exitedAfterViewingBy:{},
    autoDeleteCreatedAt:Date.now()
  }:{};
}
function getRoomParticipants(roomId=activeChatId){
  if(activeChat?.roomId===roomId && Array.isArray(activeChat.participants)) return activeChat.participants;
  const chat=chats.find(c=>c.roomId===roomId);
  return Array.isArray(chat?.participants)?chat.participants:[];
}
function isCurrentUserSender(msg){
  if(!msg) return false;
  if(msg.senderUid && currentUserUid) return msg.senderUid===currentUserUid;
  return String(msg.sender||'').toLowerCase()===String(username||'').toLowerCase();
}
function getMessageSenderUid(msg,roomId=activeChatId){
  if(msg?.senderUid) return msg.senderUid;
  if(isCurrentUserSender(msg)) return currentUserUid || null;
  const participants=getRoomParticipants(roomId);
  return participants.find(uid=>uid!==currentUserUid) || null;
}
function hasOtherParticipantViewed(msg,roomId=activeChatId){
  const participants=getRoomParticipants(roomId);
  return participants.some(uid=>uid!==getMessageSenderUid(msg,roomId) && !!msg?.viewedBy?.[uid]);
}
function getUserExpiryMs(msg,userId=currentUserUid){
  const value=msg?.expiresAtBy?.[userId];
  return typeof value==='number'?value:getFirestoreMillis(value);
}
function isHiddenForCurrentUser(msg){
  if(!currentUserUid || msg?.type==='system') return false;
  const mode=normalizeAutoDeleteMode(msg?.autoDeleteMode);
  if(!mode) return false;
  if(mode==='after_viewing') return !!msg?.exitedAfterViewingBy?.[currentUserUid];
  const expiry=getUserExpiryMs(msg,currentUserUid);
  return !!expiry && Date.now()>=expiry;
}
function shouldDeleteAutoDeleteMessage(msg,participants=getRoomParticipants()){
  if(msg?.type==='system') return false;
  const mode=normalizeAutoDeleteMode(msg?.autoDeleteMode);
  if(!mode || !participants?.length) return false;
  if(mode==='after_viewing'){
    return participants.every(uid=>!!msg?.exitedAfterViewingBy?.[uid]);
  }
  const now=Date.now();
  return participants.every(uid=>{
    const expiry=getUserExpiryMs(msg,uid);
    return !!expiry && now>=expiry;
  });
}
function isExpiredMessage(msg){
  if(shouldDeleteAutoDeleteMessage(msg)) return true;
  return !!msg?.expiresAt && Number(msg.expiresAt)<=Date.now();
}
function getOtherParticipantUidForMessage(msg,roomId=activeChatId){
  const senderUid=getMessageSenderUid(msg,roomId);
  const participants=getRoomParticipants(roomId);
  if(!senderUid || !participants?.length) return null;
  return participants.find(uid=>uid && uid!==senderUid) || null;
}

function getMessageReceiptStatusHtml(msg,roomId=activeChatId){
  const otherUid=getOtherParticipantUidForMessage(msg,roomId);
  const isSeen=!!(otherUid && msg?.seenBy?.[otherUid]);
  const isDelivered=!!(otherUid && msg?.deliveredTo?.[otherUid]);
  const status=isSeen?'seen':(isDelivered?'delivered':'sent');
  const title=status==='seen'?'Seen':(status==='delivered'?'Delivered':'Sent');
  const singleTick='<svg viewBox="0 0 18 18"><path d="M6.7 12.6 2.9 8.8 1.6 10.1l5.1 5.1 9.7-9.7-1.3-1.3z"/></svg>';
  const doubleTick='<svg viewBox="0 0 22 18"><path d="M8.1 12.6 4.3 8.8 3 10.1l5.1 5.1 9.7-9.7-1.3-1.3z"/><path d="M13.2 12.6 9.4 8.8 8.1 10.1l5.1 5.1 9.7-9.7-1.3-1.3z" transform="translate(-3.6 0)"/></svg>';
  return `<span class="tick ${status==='seen'?'seen':''}" title="${title}" aria-label="${title}">${status==='sent'?singleTick:doubleTick}</span>`;
}

async function markMessageReceivedAndSeen(roomId,msgId,msg){
  if(!currentUserUid || !roomId || !msgId || msg?.type==='system') return;
  if(activeChatId!==roomId) return;

  // A sender reading their own message must not create a seen receipt.
  if(isCurrentUserSender(msg)) return;

  const now=Date.now();
  const updates={};
  if(!msg.deliveredTo?.[currentUserUid]) updates[`deliveredTo.${currentUserUid}`]=true;
  if(!msg.deliveredAtBy?.[currentUserUid]) updates[`deliveredAtBy.${currentUserUid}`]=now;
  if(!msg.seenBy?.[currentUserUid]) updates[`seenBy.${currentUserUid}`]=true;
  if(!msg.seenAtBy?.[currentUserUid]) updates[`seenAtBy.${currentUserUid}`]=now;

  if(Object.keys(updates).length){
    await updateDoc(doc(db,'rooms',roomId,'messages',msgId),updates).catch(()=>{});
  }
}

async function markMessageViewed(roomId,msgId,msg){
  if(!currentUserUid || !roomId || !msgId || msg?.type==='system') return;
  const mode=normalizeAutoDeleteMode(msg?.autoDeleteMode);
  if(!mode) return;

  // Important: the sender reading their own message must NOT start auto-delete.
  // Auto-delete starts only after the other participant actually reads the message.
  if(isCurrentUserSender(msg)) return;

  const now=Date.now();
  const updates={};
  if(!msg.viewedBy?.[currentUserUid]) updates[`viewedBy.${currentUserUid}`]=true;
  if(!msg.viewedAtBy?.[currentUserUid]) updates[`viewedAtBy.${currentUserUid}`]=now;

  if(mode!=='after_viewing'){
    const delay=AUTO_DELETE_MODES[mode]?.delayMs;
    if(typeof delay==='number'){
      if(!getUserExpiryMs(msg,currentUserUid)) updates[`expiresAtBy.${currentUserUid}`]=now+delay;
      const senderUid=getMessageSenderUid(msg,roomId);
      if(senderUid && !getUserExpiryMs(msg,senderUid)) updates[`expiresAtBy.${senderUid}`]=now+delay;
    }
  }

  if(Object.keys(updates).length){
    await updateDoc(doc(db,'rooms',roomId,'messages',msgId),updates).catch(()=>{});
  }
}

async function markAfterViewingExit(roomId){
  if(!roomId || !currentUserUid) return;
  try{
    const snap=await getDocs(collection(db,'rooms',roomId,'messages'));
    const updates=[];
    snap.docs.forEach(ds=>{
      const msg=ds.data();
      if(msg?.type==='system') return;
      if(normalizeAutoDeleteMode(msg?.autoDeleteMode)!=='after_viewing') return;
      if(msg.exitedAfterViewingBy?.[currentUserUid]) return;
      // Sender ke side se message tab tak hide/delete mat karo jab tak saamne wala read na kar le.
      if(isCurrentUserSender(msg) && !hasOtherParticipantViewed(msg,roomId)) return;
      const now=Date.now();
      const updateData={
        [`viewedBy.${currentUserUid}`]:true,
        [`viewedAtBy.${currentUserUid}`]:now,
        [`exitedAfterViewingBy.${currentUserUid}`]:true
      };
      if(!isCurrentUserSender(msg)){
        const senderUid=getMessageSenderUid(msg,roomId);
        if(senderUid) updateData[`viewedBy.${senderUid}`]=true;
      }
      updates.push(updateDoc(doc(db,'rooms',roomId,'messages',ds.id),updateData).catch(()=>{}));
    });
    if(updates.length) await Promise.all(updates);
    await cleanupExpiredMessages(roomId);
  }catch(err){console.warn('Auto-delete exit update failed',err);}
}


function validateEmail(email){
  if(!email?.trim()) return 'Email required';
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email';
  return null;
}
function cleanDisplayName(value){
  const base=String(value||'user').split('@')[0].replace(/[^a-zA-Z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'') || 'user';
  return base.slice(0,18);
}
function makeAuthUsername(user){
  const base=cleanDisplayName(user.displayName || user.email || 'user');
  const suffix=(user.uid||'').slice(0,5);
  const name=`${base}_${suffix}`.slice(0,24);
  return name.length>=3?name:`user_${suffix}`;
}
async function getExistingFirebaseProfile(user){
  if(!user) return null;
  try{
    const snap=await getDoc(doc(db,'users',user.uid));
    return snap.exists()?snap.data():null;
  }catch{
    return null;
  }
}
async function isUsernameAvailable(name,currentUid){
  const key=getUsernameKey(name);
  const snap=await getDoc(doc(db,'usernames',key)).catch(()=>null);
  if(!snap || !snap.exists()) return true;
  return snap.data()?.uid===currentUid;
}
async function saveFirebaseUserProfile(user, preferredName){
  if(!user) return null;
  const existing=await getExistingFirebaseProfile(user);
  const profileName=preferredName || existing?.username || null;
  if(!profileName) return null;

  const usernameError=validateUsername(profileName);
  if(usernameError) throw new Error(usernameError);
  const key=getUsernameKey(profileName);
  const available=await isUsernameAvailable(profileName,user.uid);
  if(!available) throw new Error('Username already taken');

  const localUsers=loadUsers();
  localUsers[key]={
    uid:user.uid,
    username:profileName,
    email:user.email||'',
    provider:user.providerData?.[0]?.providerId||'password',
    createdAt:new Date().toISOString()
  };
  saveUsers(localUsers);
  setCurrentUser(profileName);
  await setDoc(doc(db,'users',user.uid),{
    uid:user.uid,
    username:profileName,
    email:user.email||'',
    providers:user.providerData?.map(p=>p.providerId)||[],
    updatedAt:serverTimestamp(),
    createdAt:existing?.createdAt || serverTimestamp()
  },{merge:true}).catch(()=>{});
  await setDoc(doc(db,'usernames',key),{
    uid:user.uid,
    username:profileName,
    updatedAt:serverTimestamp()
  },{merge:true}).catch(()=>{});
  if(auth.currentUser && auth.currentUser.displayName!==profileName){
    await updateProfile(auth.currentUser,{displayName:profileName}).catch(()=>{});
  }
  return profileName;
}
function showUsernameSetup(user){
  loginScreen.classList.remove('active');
  mainScreen.classList.remove('active');
  usernameSetupScreen.classList.add('active');
  const suggestion=makeAuthUsername(user);
  E('setup-username').value=suggestion;
  E('setup-username-error').textContent='';
  E('setup-username-helper').textContent='Letters, numbers, underscore. Min 3 chars.';
}
async function finishFirebaseLogin(user, preferredName){
  currentUserUid=user?.uid||currentUserUid;
  const name=await saveFirebaseUserProfile(user, preferredName).catch(err=>{
    E('setup-username-error').textContent=err.message || 'Username setup failed';
    return null;
  });
  if(!name){
    showUsernameSetup(user);
    return false;
  }
  username=name;
  showToast('Signed in successfully','success');
  initMainScreen();
  return true;
}

const validateUsername=u=>{ if(!u?.trim()) return 'Username required'; if(u.length<3) return 'Min 3 chars'; if(u.length>24) return 'Max 24 chars'; if(!/^[a-zA-Z0-9_]+$/.test(u)) return 'Letters, numbers, underscore only'; return null; };
const validatePassword=p=>{ if(!p?.trim()) return 'Password required'; if(p.length<6) return 'Min 6 chars'; return null; };

async function signup(email,password,confirmPassword){
  const ee=validateEmail(email); if(ee){E('signup-error').textContent=ee;return false;}
  const pe=validatePassword(password); if(pe){E('signup-error').textContent=pe;return false;}
  if(password!==confirmPassword){E('signup-error').textContent='Passwords do not match';return false;}
  try{
    const cred=await createUserWithEmailAndPassword(auth,email.trim(),password);
    showToast('Account created. Choose username.','success');
    showUsernameSetup(cred.user);
    return true;
  }catch(err){
    E('signup-error').textContent=getAuthErrorMessage(err);
    return false;
  }
}
async function login(email,password){
  if(!email){E('login-error').textContent='Enter email';return false;}
  if(!password){E('login-error').textContent='Enter password';return false;}
  try{
    const cred=await signInWithEmailAndPassword(auth,email.trim(),password);
    await finishFirebaseLogin(cred.user);
    return true;
  }catch(err){
    E('login-error').textContent=getAuthErrorMessage(err);
    return false;
  }
}
function getAuthErrorMessage(err){
  const code=err?.code||'';
  if(code.includes('email-already-in-use')) return 'Email already used';
  if(code.includes('invalid-email')) return 'Enter a valid email';
  if(code.includes('weak-password')) return 'Password is too weak';
  if(code.includes('user-not-found')||code.includes('invalid-credential')||code.includes('wrong-password')) return 'Invalid email or password';
  if(code.includes('popup-closed-by-user')) return 'Google sign-in cancelled';
  if(code.includes('too-many-requests')) return 'Too many attempts. Try later';
  return err?.message || 'Authentication failed';
}
async function signInWithGoogleAuth(targetErrorId){
  try{
    const cred=await signInWithPopup(auth,googleProvider);
    await finishFirebaseLogin(cred.user);
    return true;
  }catch(err){
    E(targetErrorId).textContent=getAuthErrorMessage(err);
    return false;
  }
}
async function changePassword(username,oldPass,newPass,confirmNew){
  const pe=validatePassword(newPass); if(pe) return pe;
  if(newPass!==confirmNew) return 'Passwords do not match';
  const users=loadUsers(),key=getUsernameKey(username);
  if(!users[key]) return 'Account not found';
  const u=users[key];
  const ok=u.password?u.password===oldPass:await verifyPassword(oldPass,u.passwordHash);
  if(!ok) return 'Current password incorrect';
  u.passwordHash=await hashPassword(newPass); delete u.password; saveUsers(users); return null;
}
async function deleteAccountFn(username,password){
  const users=loadUsers(),key=getUsernameKey(username);
  if(!users[key]) return false;
  const u=users[key];
  const ok=u.password?u.password===password:await verifyPassword(password,u.passwordHash);
  if(!ok) return false;
  delete users[key]; saveUsers(users); setCurrentUser(null);
  localStorage.removeItem(scopedStorageKey(CHATS_KEY)); localStorage.removeItem(scopedStorageKey(BLOCK_KEY)); localStorage.removeItem(scopedStorageKey(DISAPPEAR_SETTINGS_KEY)); localStorage.removeItem(scopedStorageKey(CHAT_KEYS_KEY)); if(auth.currentUser){await deleteUser(auth.currentUser).catch(()=>{});} return true;
}

const E=id=>document.getElementById(id);
const getRoomId=(a,b)=>[String(a).toLowerCase(),String(b).toLowerCase()].sort().join('__');
const getRoomIdByUid=(uidA,uidB)=>[String(uidA),String(uidB)].sort().join('__');
async function getUserByUsername(name){
  const key=getUsernameKey(name);
  const snap=await getDoc(doc(db,'usernames',key)).catch(()=>null);
  if(!snap || !snap.exists()) return null;
  const data=snap.data()||{};
  return {uid:data.uid,username:data.username||name};
}
async function getUsernameByUid(uid){
  const snap=await getDoc(doc(db,'users',uid)).catch(()=>null);
  return snap?.exists()?snap.data()?.username:null;
}
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const COLORS=['#00c9a7','#7B66FF','#0096ff','#0EA5E9','#F472B6','#10B981','#06B6D4','#34D399'];
const getColor=n=>COLORS[(n||'?').charCodeAt(0)%COLORS.length];
function fmtTime(ts){if(!ts)return'';const d=ts.toDate?ts.toDate():new Date(ts);return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function fmtDate(ts){if(!ts)return'Today';const d=ts.toDate?ts.toDate():new Date(ts);const t=new Date();if(d.toDateString()===t.toDateString())return'Today';const y=new Date(t);y.setDate(t.getDate()-1);if(d.toDateString()===y.toDateString())return'Yesterday';return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'});}

const enc=new TextEncoder();
const dec=new TextDecoder();
function bytesToBase64(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes)));}
function base64ToBytes(base64){return Uint8Array.from(atob(base64),c=>c.charCodeAt(0));}

// Production E2EE needs secure identity keys, public-key exchange, device verification, and backend support.
async function getOrCreateChatKey(chatId){
  const keyStore=(()=>{try{return JSON.parse(localStorage.getItem(scopedStorageKey(CHAT_KEYS_KEY))||'{}')}catch{return{}}})();
  const saltBase64=keyStore[chatId]?.salt||bytesToBase64(enc.encode('bliptwit_demo_e2ee_salt_v1'));
  if(!keyStore[chatId]){
    keyStore[chatId]={salt:saltBase64,createdAt:new Date().toISOString()};
    localStorage.setItem(scopedStorageKey(CHAT_KEYS_KEY),JSON.stringify(keyStore));
  }
  const keyMaterial=await crypto.subtle.importKey('raw',enc.encode('bliptwit_demo_e2ee_'+chatId),{name:'PBKDF2'},false,['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2',salt:base64ToBytes(saltBase64),iterations:120000,hash:'SHA-256'},
    keyMaterial,
    {name:'AES-GCM',length:256},
    false,
    ['encrypt','decrypt']
  );
}
async function exportChatKeyMetadata(chatId){
  const keyStore=(()=>{try{return JSON.parse(localStorage.getItem(scopedStorageKey(CHAT_KEYS_KEY))||'{}')}catch{return{}}})();
  await getOrCreateChatKey(chatId);
  return keyStore[chatId]||null;
}
function importChatKeyMetadata(chatId,metadata){
  if(!chatId||!metadata?.salt) return;
  const keyStore=(()=>{try{return JSON.parse(localStorage.getItem(scopedStorageKey(CHAT_KEYS_KEY))||'{}')}catch{return{}}})();
  keyStore[chatId]=metadata;
  localStorage.setItem(scopedStorageKey(CHAT_KEYS_KEY),JSON.stringify(keyStore));
}
async function encryptMessageData(data,chatId){
  const key=await getOrCreateChatKey(chatId);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=enc.encode(JSON.stringify(data));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,plain);
  return {encrypted:true,cipherText:bytesToBase64(encrypted),iv:bytesToBase64(iv)};
}
async function decryptMessageData(message,chatId){
  if(!message?.encrypted) return message;
  try{
    const key=await getOrCreateChatKey(chatId);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:base64ToBytes(message.iv)},key,base64ToBytes(message.cipherText));
    return {...message,...JSON.parse(dec.decode(plain))};
  }catch(err){
    console.warn('Decrypt failed',err);
    return {...message,decryptionFailed:true,text:'Unable to decrypt message'};
  }
}
const ONLINE_THRESHOLD_MS=25000;
const STATUS_REFRESH_MS=10000;
let statusRefreshInterval=null;

let chats=loadChats(),username=getCurrentUser()||'',blockedUsers=loadBlocked();
let activeChatId=null,activeChat=null;
let unsubMessages=null,unsubTyping=null,unsubRequests=null,unsubPresence=null,unsubRooms=null;
let messagesRenderSeq=0;
let presenceByUid={};
let typingTimeout=null,incomingReqs=[],sentReqs=[];
let pendingBlockUser=null,replyTo=null,profileModalUser=null;
let ctxMsgId=null,ctxMsgData=null;

// Voice recording variables
let mediaRecorder=null,audioChunks=[],recordingTimer=null,recordingSeconds=0;
let currentAudio=null;

// Swipe to reply variables
let swipeStartX=0,swipeStartY=0,swipeThreshold=80,swipeActive=false;
let currentSwipeRow=null;

const isBlocked=u=>blockedUsers.some(b=>b.toLowerCase()===String(u||'').toLowerCase());

function updateBlockedChatUI(){
  const blocked=!!(activeChat && isBlocked(activeChat.name));
  document.body.classList.toggle('chat-is-blocked',blocked);
  const footer=E('blocked-chat-footer');
  const txt=E('blocked-chat-text');
  if(footer) footer.classList.toggle('show',blocked);
  if(txt && activeChat) txt.textContent=`${activeChat.name} is blocked. You can read old messages.`;
  if(blocked){
    msgInput.value='';
    msgInput.style.height='auto';
    sendBtn.disabled=true;
    clearReply();
    if(mediaRecorder?.state==='recording') cancelRecording();
  }
}

function addToBlockList(user){
  if(!user) return;
  if(!isBlocked(user)){
    blockedUsers.push(user);
    saveBlocked(blockedUsers);
    // Keep the chat in the chat list. Blocking should only disable sending, not delete history.
    renderChats(searchInput?.value?.trim().toLowerCase()||'');
    updateBlockedChatUI();
    showToast(`${user} blocked`,'success');
  }
}
function removeFromBlockList(user){
  blockedUsers=blockedUsers.filter(b=>b.toLowerCase()!==String(user||'').toLowerCase());
  saveBlocked(blockedUsers);
  renderChats(searchInput?.value?.trim().toLowerCase()||'');
  updateBlockedChatUI();
  renderBlockList();
  showToast(`${user} unblocked`,'success');
}

let toastTimer;
function showToast(msg,type=''){
  const t=E('toast'); t.textContent=msg;
  t.className=type==='success'?'show success-toast':type==='error'?'show error-toast':'show';
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.className='',2800);
}

const loginScreen=E('login-screen'),usernameSetupScreen=E('username-setup-screen'),mainScreen=E('main-screen'),chatScreen=E('chat-screen');
const signupForm=E('signup-form'),loginForm=E('login-form');
const chatList=E('chat-list'),emptyState=E('empty-state'),fabBtn=E('fab-btn');
const reqPanelContent=E('req-panel-content'),reqTabBadge=E('req-tab-badge');
const modalOverlay=E('modal-overlay'),newChatInput=E('new-chat-input'),modalError=E('modal-error'),sendRequestBtn=E('send-request-btn');
const backBtn=E('back-btn'),chAvatar=E('ch-avatar'),chName=E('ch-name'),chStatus=E('ch-status');
const messagesWrap=E('messages-wrap'),msgInput=E('msg-input'),sendBtn=E('send-btn');
const typingIndicator=E('typing-indicator');
const menuOverlay=E('menu-overlay'),menuUsername=E('menu-username');
const actionSheet=E('action-sheet'),actionSheetTitle=E('action-sheet-title');
const replyBar=E('reply-bar'),replyToName=E('reply-to-name'),replyToText=E('reply-to-text'),replyBarClose=E('reply-bar-close');
const searchToggleBtn=E('search-toggle-btn'),searchBar=E('search-bar'),searchInput=E('search-input'),searchClear=E('search-clear');
const ctxOverlay=E('ctx-overlay'),ctxMenu=E('ctx-menu');
const reactionPickerOverlay=E('reaction-picker-overlay'),reactionPicker=E('reaction-picker');
const micBtn=E('mic-btn'),voiceRecordingUI=E('voice-recording-ui');
const recordingTimerEl=E('recording-timer');
const sendBtnEl=E('send-btn');

E('show-signup-toggle').addEventListener('click',()=>{
  signupForm.classList.remove('hidden'); loginForm.classList.add('hidden');
  E('show-signup-toggle').classList.add('active'); E('show-login-toggle').classList.remove('active');
  E('signup-error').textContent=''; E('login-error').textContent='';
});
E('show-login-toggle').addEventListener('click',()=>{
  loginForm.classList.remove('hidden'); signupForm.classList.add('hidden');
  E('show-login-toggle').classList.add('active'); E('show-signup-toggle').classList.remove('active');
  E('signup-error').textContent=''; E('login-error').textContent='';
});
E('signup-submit').addEventListener('click',async()=>{
  const btn=E('signup-submit'); btn.disabled=true; btn.textContent='Creating…';
  const ok=await signup(E('signup-username').value.trim(),E('signup-password').value,E('signup-confirm').value);
  btn.disabled=false; btn.textContent='Create Account';
});
E('login-submit').addEventListener('click',async()=>{
  const btn=E('login-submit'); btn.disabled=true; btn.textContent='Signing in…';
  const ok=await login(E('login-username').value.trim(),E('login-password').value);
  btn.disabled=false; btn.textContent='Sign In';
});
E('google-signup-btn').addEventListener('click',()=>signInWithGoogleAuth('signup-error'));
E('google-login-btn').addEventListener('click',()=>signInWithGoogleAuth('login-error'));
E('setup-username').addEventListener('input',function(){
  const value=this.value.trim();
  const err=validateUsername(value);
  const helper=E('setup-username-helper');
  if(err&&value){this.classList.add('error');this.classList.remove('valid');helper.textContent=err;helper.style.color='var(--danger)';}
  else if(!err&&value){this.classList.remove('error');this.classList.add('valid');helper.textContent='Username looks good.';helper.style.color='var(--accent-primary)';}
  else{this.classList.remove('error','valid');helper.textContent='Letters, numbers, underscore. Min 3 chars.';helper.style.color='';}
});
E('setup-username-submit').addEventListener('click',async()=>{
  const btn=E('setup-username-submit');
  const chosen=E('setup-username').value.trim();
  const err=validateUsername(chosen);
  if(err){E('setup-username-error').textContent=err;return;}
  if(!auth.currentUser){E('setup-username-error').textContent='Please sign in again';return;}
  btn.disabled=true; btn.textContent='Saving…';
  try{
    const available=await isUsernameAvailable(chosen,auth.currentUser.uid);
    if(!available) throw new Error('Username already taken');
    await finishFirebaseLogin(auth.currentUser,chosen);
  }catch(err){
    E('setup-username-error').textContent=err.message || 'Could not save username';
  }
  btn.disabled=false; btn.textContent='Continue';
});
E('setup-logout-btn').addEventListener('click',async()=>{
  await signOut(auth).catch(()=>{});
  setCurrentUser(null);
  username='';
  currentUserUid=null;
  usernameSetupScreen.classList.remove('active');
  loginScreen.classList.add('active');
});
function initMainScreen(){
  menuUsername.textContent=username;
  E('menu-avatar-letter').textContent=username[0].toUpperCase();
  E('menu-avatar-letter').style.background=getColor(username);
  loginScreen.classList.remove('active'); usernameSetupScreen.classList.remove('active'); mainScreen.classList.add('active');
  chats=[];
  blockedUsers=loadBlocked();
  renderChats();
  listenForPresence();
  startStatusRefresh();
  listenForRooms();
  cleanupAllKnownChats();
  listenForRequests();
  E('signup-username').value=''; E('signup-password').value=''; E('signup-confirm').value='';
  E('login-username').value=''; E('login-password').value='';
}


function getUsernameKey(name){
  return (name||'').trim().toLowerCase();
}
function getPresenceTimeMs(lastSeen){
  if(!lastSeen) return 0;
  if(typeof lastSeen==='number') return lastSeen;
  if(lastSeen.toMillis) return lastSeen.toMillis();
  if(lastSeen.toDate) return lastSeen.toDate().getTime();
  const parsed=new Date(lastSeen).getTime();
  return Number.isNaN(parsed)?0:parsed;
}
function formatLastSeen(ts){
  const lastSeenMs=getPresenceTimeMs(ts);
  if(!lastSeenMs) return 'offline';
  const diffMs=Math.max(0,Date.now()-lastSeenMs);
  const minuteMs=60*1000;
  const hourMs=60*minuteMs;
  const dayMs=24*hourMs;
  if(diffMs<minuteMs) return 'last seen just now';
  if(diffMs<hourMs){
    const minutes=Math.max(1,Math.floor(diffMs/minuteMs));
    return `last seen ${minutes}m ago`;
  }
  if(diffMs<dayMs){
    const hours=Math.max(1,Math.floor(diffMs/hourMs));
    return `last seen ${hours}h ago`;
  }
  const days=Math.max(1,Math.floor(diffMs/dayMs));
  return `last seen ${days}d ago`;
}
function isUserOnlineRecord(user){
  const lastSeenMs=getPresenceTimeMs(user?.lastSeenMs);
  return !!lastSeenMs && Date.now()-lastSeenMs<=ONLINE_THRESHOLD_MS;
}
function getPresenceByUid(uid){
  return uid?presenceByUid[String(uid)]||null:null;
}
function getUserStatusSnapshot(chat){
  const uid=typeof chat==='string'?chat:chat?.otherUid;
  const name=typeof chat==='string'?chat:chat?.name;
  const user=getPresenceByUid(uid);
  const lastSeen=user?.lastSeenMs||null;
  const online=isUserOnlineRecord(user);
  return {online,lastSeen,status:online?'online':'offline',username:user?.username||name||'',uid:uid||''};
}
function syncChatStatuses(){
  chats=chats.map(chat=>{
    const snapshot=getUserStatusSnapshot(chat);
    return {...chat,online:snapshot.online,lastSeen:snapshot.lastSeen};
  });
  saveChats(chats);
}
function updateChatHeaderStatus(){
  if(!activeChat||!chStatus) return;
  const mode=getRoomAutoDelete(activeChat.roomId);
  if(mode){
    chStatus.textContent=`Auto delete: ${getAutoDeleteLabel(mode)}`;
    return;
  }
  const snapshot=getUserStatusSnapshot(activeChat);
  if(typingIndicator.classList.contains('show')) return;
  chStatus.textContent=snapshot.online?'online':formatLastSeen(snapshot.lastSeen);
}
function updateCurrentUserPresence(status='online'){
  if(!username||!currentUserUid) return Promise.resolve();
  const nowMs=Date.now();
  const online=status==='online';
  const presence={
    uid:currentUserUid,
    username,
    status:online?'online':'offline',
    online,
    lastSeenMs:nowMs,
    updatedAt:serverTimestamp()
  };
  presenceByUid[currentUserUid]={...presence,updatedAt:null};
  return setDoc(doc(db,'presence',currentUserUid),presence,{merge:true}).catch(()=>{});
}
function listenForPresence(){
  if(unsubPresence) unsubPresence();
  unsubPresence=onSnapshot(collection(db,'presence'),snap=>{
    snap.docs.forEach(d=>{
      const data=d.data()||{};
      const uid=data.uid||d.id;
      presenceByUid[uid]={...data,uid};
    });
    refreshPresenceUI();
  },()=>{});
}
function stopPresenceListener(){
  if(unsubPresence){
    unsubPresence();
    unsubPresence=null;
  }
  presenceByUid={};
}
function refreshPresenceUI(){
  syncChatStatuses();
  const q=searchInput?.value?.trim().toLowerCase()||'';
  renderChats(q);
  updateChatHeaderStatus();
}
function startStatusRefresh(){
  stopStatusRefresh();
  updateCurrentUserPresence('online');
  refreshPresenceUI();
  statusRefreshInterval=setInterval(()=>{
    const status=document.visibilityState==='hidden'?'offline':'online';
    updateCurrentUserPresence(status);
    refreshPresenceUI();
  },STATUS_REFRESH_MS);
}
function stopStatusRefresh(){
  if(statusRefreshInterval){
    clearInterval(statusRefreshInterval);
    statusRefreshInterval=null;
  }
}

searchToggleBtn.addEventListener('click',()=>{
  const shown=searchBar.style.display==='block';
  searchBar.style.display=shown?'none':'block';
  if(!shown){searchInput.focus();}else{searchInput.value='';renderChats();searchClear.style.display='none';}
});
searchInput.addEventListener('input',()=>{
  const q=searchInput.value.trim().toLowerCase();
  searchClear.style.display=q?'block':'none'; renderChats(q);
});
searchClear.addEventListener('click',()=>{searchInput.value='';searchClear.style.display='none';renderChats();});

function renderChats(filter=''){
  chatList.innerHTML='';
  let visible=chats.slice();
  if(filter) visible=visible.filter(c=>c.name.toLowerCase().includes(filter));
  const total=chats.length;
  const chatCountBadge=E('chat-count');
  if(total>0){chatCountBadge.style.display='';chatCountBadge.textContent=total;}
  else chatCountBadge.style.display='none';
  if(!visible.length){emptyState.style.display='flex';fabBtn.classList.add('hidden');return;}
  emptyState.style.display='none'; fabBtn.classList.remove('hidden');
  visible.forEach(chat=>{
    const c=getColor(chat.name);
    const hasUnread=chat.unread>0;
    const item=document.createElement('div');
    item.className='chat-item';
    item.innerHTML=`
      <div class="avatar" style="background:${c};">${esc(chat.name[0].toUpperCase())}<div class="online-dot ${getUserStatusSnapshot(chat).online?'':'offline'}"></div></div>
      <div class="chat-info">
        <div class="chat-name-row">
          <div class="chat-name">${esc(chat.name)}</div>
          <div class="chat-time">${esc(chat.time||'')}</div>
        </div>
        <div class="chat-preview-row">
          <div class="chat-preview${hasUnread?' unread-preview':''}">${isBlocked(chat.name)?'Blocked · ':''}${chat.isVoice?'🎤 Voice message':chat.isImage?'📷 Photo':(chat.preview?esc(chat.preview):'')}</div>
          ${hasUnread?`<span class="unread-badge">${chat.unread}</span>`:''}
        </div>
      </div>
    `;
    item.addEventListener('click',()=>openChat(chat));
    item.addEventListener('contextmenu',e=>{e.preventDefault();openActionSheet(chat.name);});
    let pressTimer;
    item.addEventListener('touchstart',()=>{pressTimer=setTimeout(()=>openActionSheet(chat.name),500);},{passive:true});
    item.addEventListener('touchend',()=>clearTimeout(pressTimer));
    chatList.appendChild(item);
  });
}


function stopRoomListener(){
  if(unsubRooms){
    unsubRooms();
    unsubRooms=null;
  }
}
function getFirestoreMillis(value){
  if(!value) return 0;
  if(value.toMillis) return value.toMillis();
  if(value.toDate) return value.toDate().getTime();
  if(typeof value==='number') return value;
  const parsed=new Date(value).getTime();
  return Number.isNaN(parsed)?0:parsed;
}
function roomDocToChat(docSnap){
  const data=docSnap.data()||{};
  const participants=Array.isArray(data.participants)?data.participants:[];
  const names=Array.isArray(data.participantUsernames)?data.participantUsernames:[];
  const otherIndex=participants.findIndex(uid=>uid!==currentUserUid);
  const otherUid=otherIndex>=0?participants[otherIndex]:'';
  const otherName=(otherIndex>=0 && names[otherIndex]) || data.otherUsername || 'Unknown';
  const updatedMs=getFirestoreMillis(data.updatedAt||data.createdAt);
  return {
    roomId:docSnap.id,
    name:otherName,
    otherUid,
    preview:data.lastMessagePreview||'',
    time:updatedMs?new Date(updatedMs).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'',
    unread:0,
    isVoice:data.lastMessageType==='voice',
    isImage:data.lastMessageType==='image',
    updatedMs,
    participants,
    participantUsernames:names,
    autoDelete:data.autoDelete||null,
    autoDeleteMode:normalizeAutoDeleteMode(data.autoDelete?.mode)
  };
}
function listenForRooms(){
  stopRoomListener();
  if(!currentUserUid) return;
  const roomsQuery=query(collection(db,'rooms'),where('participants','array-contains',currentUserUid));
  unsubRooms=onSnapshot(roomsQuery,snap=>{
    chats=snap.docs
      .map(roomDocToChat)
      .filter(chat=>chat.otherUid && chat.name)
      .sort((a,b)=>(b.updatedMs||0)-(a.updatedMs||0));
    saveChats(chats);
    renderChats(searchInput?.value?.trim().toLowerCase()||'');
  },err=>{
    console.error(err);
    showToast('Could not load your chats','error');
  });
}
async function upsertRoomForChat(otherUid,otherUsername){
  if(!currentUserUid || !otherUid) throw new Error('Missing user id');
  const roomId=getRoomIdByUid(currentUserUid,otherUid);
  const participants=[currentUserUid,otherUid];
  const participantUsernames=[username,otherUsername];
  await setDoc(doc(db,'rooms',roomId),{
    participants,
    participantUsernames,
    createdAt:serverTimestamp(),
    updatedAt:serverTimestamp()
  },{merge:true});
  return roomId;
}

function openActionSheet(chatName){
  pendingBlockUser=chatName;
  actionSheetTitle.textContent=chatName;
  const targetChat=chats.find(c=>c.name===chatName)||activeChat;
  const currentMode=(targetChat?.roomId?getRoomAutoDelete(targetChat.roomId):null) || 'never';
  document.querySelectorAll('.disappear-option').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.autoDeleteMode===currentMode);
  });
  const currentLabel=E('action-auto-delete-current');
  if(currentLabel) currentLabel.textContent=getAutoDeleteLabel(currentMode);
  const sheetPanel=actionSheet?.querySelector('.action-sheet');
  sheetPanel?.classList.remove('auto-delete-picker');
  E('auto-delete-submenu')?.classList.remove('show');
  actionSheet.classList.add('open');
}
const showAutoDeleteOptions=()=>{
  const sheetPanel=actionSheet?.querySelector('.action-sheet');
  sheetPanel?.classList.add('auto-delete-picker');
  E('auto-delete-submenu')?.classList.add('show');
};
const closeActionSheet=()=>{
  actionSheet.classList.remove('open');
  actionSheet?.querySelector('.action-sheet')?.classList.remove('auto-delete-picker');
  E('auto-delete-submenu')?.classList.remove('show');
  pendingBlockUser=null;
};
E('action-cancel').addEventListener('click',closeActionSheet);
E('action-auto-delete-menu')?.addEventListener('click',showAutoDeleteOptions);
E('auto-delete-back')?.addEventListener('click',()=>{
  actionSheet?.querySelector('.action-sheet')?.classList.remove('auto-delete-picker');
  E('auto-delete-submenu')?.classList.remove('show');
});
E('action-view-profile').addEventListener('click',()=>{if(pendingBlockUser){openProfileModal(pendingBlockUser);closeActionSheet();}});
E('action-block-user').addEventListener('click',()=>{if(pendingBlockUser){addToBlockList(pendingBlockUser);closeActionSheet();}});
E('action-delete-chat').addEventListener('click',()=>{
  if(pendingBlockUser){
    chats=chats.filter(c=>c.name!==pendingBlockUser); saveChats(chats); renderChats(); showToast('Chat deleted');
  }
  closeActionSheet();
});

document.querySelectorAll('.disappear-option').forEach(btn=>{
  btn.addEventListener('click',async()=>{
    const targetChat=chats.find(c=>c.name===pendingBlockUser)||activeChat;
    if(!targetChat?.roomId) return;
    const mode=normalizeAutoDeleteMode(btn.dataset.autoDeleteMode);
    if(!mode) return;
    const label=getAutoDeleteLabel(mode);
    const currentMode=normalizeAutoDeleteMode(targetChat.autoDeleteMode || targetChat.autoDelete?.mode || getRoomAutoDelete(targetChat.roomId));
    if(currentMode===mode){
      closeActionSheet();
      showToast(`Auto-delete already set: ${label}`,'success');
      return;
    }
    const autoDelete=mode==='never'?null:{
      mode,
      selectedBy:currentUserUid||'',
      selectedByName:username||'Someone',
      selectedAt:Date.now()
    };
    try{
      await setDoc(doc(db,'rooms',targetChat.roomId),{autoDelete,updatedAt:serverTimestamp()},{merge:true});
      targetChat.autoDelete=autoDelete;
      targetChat.autoDeleteMode=mode;
      if(activeChatId===targetChat.roomId){
        activeChat={...activeChat,...targetChat,autoDelete,autoDeleteMode:mode};
        updateChatHeaderStatus();
      }
      document.querySelectorAll('.disappear-option').forEach(b=>b.classList.toggle('active',b.dataset.autoDeleteMode===mode));
      const currentLabel=E('action-auto-delete-current');
      if(currentLabel) currentLabel.textContent=label;
      closeActionSheet();
      showToast(`Auto-delete set: ${label}`,'success');
    }catch(err){
      console.error(err);
      showToast('Could not update auto-delete','error');
    }
  });
});
actionSheet.addEventListener('click',e=>{if(e.target===actionSheet)closeActionSheet();});

E('chat-more-btn').addEventListener('click',()=>{if(activeChat)openActionSheet(activeChat.name);});
E('ch-header-info').addEventListener('click',()=>{if(activeChat)openProfileModal(activeChat.name);});

function openProfileModal(user){
  profileModalUser=user;
  const c=getColor(user);
  const users=loadUsers(),u=users[user.toLowerCase()];
  const joined=u?.createdAt?new Date(u.createdAt).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}):'Unknown';
  E('profile-modal-content').innerHTML=`
    <div class="profile-avatar-lg" style="background:${c};">${esc(user[0].toUpperCase())}</div>
    <div class="profile-username">${esc(user)}</div>
    <div class="profile-meta">Joined ${joined}</div>
  `;
  E('profile-modal').classList.add('open');
}
E('close-profile-btn').addEventListener('click',()=>E('profile-modal').classList.remove('open'));
E('block-from-profile-btn').addEventListener('click',()=>{if(profileModalUser){addToBlockList(profileModalUser);E('profile-modal').classList.remove('open');}});
E('profile-modal').addEventListener('click',e=>{if(e.target===E('profile-modal'))E('profile-modal').classList.remove('open');});

function listenForRequests(){
  if(unsubRequests) unsubRequests();
  if(!username) return;
  const qIn=query(collection(db,'requests'),where('to','==',username),where('status','==','pending'));
  const qOut=query(collection(db,'requests'),where('from','==',username));
  const u1=onSnapshot(qIn,snap=>{incomingReqs=snap.docs.map(d=>({id:d.id,...d.data()}));updateBadge();renderRequestsPanel();});
  const u2=onSnapshot(qOut,snap=>{
    sentReqs=snap.docs.map(d=>({id:d.id,...d.data()}));
    sentReqs.forEach(async req=>{
      if(req.status==='accepted'){
        const roomId=(req.fromUid&&req.toUid)?getRoomIdByUid(req.fromUid,req.toUid):getRoomId(req.from,req.to);
        showToast(`${req.to} accepted your request!`,'success');
        await deleteDoc(doc(db,'requests',req.id)).catch(()=>{});
      }
    });
    renderRequestsPanel();
  });
  unsubRequests=()=>{u1();u2();};
}
function updateBadge(){const n=incomingReqs.length;reqTabBadge.style.display=n>0?'':'none';reqTabBadge.textContent=n;}
function renderRequestsPanel(){
  const pending=sentReqs.filter(r=>r.status==='pending');
  const declined=sentReqs.filter(r=>r.status==='declined');
  const filtered=incomingReqs.filter(r=>!isBlocked(r.from));
  if(!filtered.length&&!pending.length&&!declined.length){reqPanelContent.innerHTML='<div class="req-empty">No requests yet.<br/>Tap + to send a chat request.</div>';return;}
  let html='';
  if(filtered.length){
    html+=`<div class="req-section-label">Incoming</div>`;
    filtered.forEach(r=>{const c=getColor(r.from);html+=`<div class="req-item"><div class="avatar" style="background:${c};width:44px;height:44px;border-radius:50%;">${esc(r.from[0].toUpperCase())}</div><div class="req-info"><div class="req-name">${esc(r.from)}</div><div class="req-sub">wants to chat</div></div><div class="req-actions"><button class="btn-accept" data-id="${r.id}" data-from="${esc(r.from)}">Accept</button><button class="btn-decline" data-id="${r.id}">Decline</button></div></div>`;});
  }
  if(pending.length){
    html+=`<div class="req-section-label">Sent</div>`;
    pending.forEach(r=>{const c=getColor(r.to);html+=`<div class="req-sent-item"><div class="avatar" style="background:${c};width:44px;height:44px;border-radius:50%;">${esc(r.to[0].toUpperCase())}</div><div class="req-sent-info"><div class="req-sent-name">${esc(r.to)}</div><div class="req-sent-sub">Waiting for response</div></div><span class="status-pill pending">Pending</span></div>`;});
  }
  if(declined.length){
    html+=`<div class="req-section-label">Declined</div>`;
    declined.forEach(r=>{html+=`<div class="req-sent-item"><div class="avatar" style="background:var(--surface3);width:44px;height:44px;border-radius:50%;">${esc(r.to[0].toUpperCase())}</div><div class="req-sent-info"><div class="req-sent-name">${esc(r.to)}</div><div class="req-sent-sub">Request declined</div></div><button style="background:none;border:1px solid var(--border-light);color:var(--text-secondary);border-radius:6px;padding:5px 10px;font-size:.75rem;cursor:pointer;" data-clear="${r.id}">Clear</button></div>`;});
  }
  reqPanelContent.innerHTML=html;
  reqPanelContent.querySelectorAll('.btn-accept').forEach(b=>b.addEventListener('click',()=>acceptRequest(b.dataset.id,b.dataset.from)));
  reqPanelContent.querySelectorAll('.btn-decline').forEach(b=>b.addEventListener('click',()=>declineRequest(b.dataset.id)));
  reqPanelContent.querySelectorAll('[data-clear]').forEach(b=>b.addEventListener('click',()=>deleteDoc(doc(db,'requests',b.dataset.clear)).catch(()=>{})));
}
async function sendChatRequest(toUser){
  if(!currentUserUid) return 'Please sign in again';
  if(isBlocked(toUser)) return `${toUser} is blocked`;
  const other=await getUserByUsername(toUser);
  if(!other?.uid) return 'User not found';
  if(other.uid===currentUserUid) return "Can't chat with yourself";
  const roomId=getRoomIdByUid(currentUserUid,other.uid);
  if(sentReqs.find(r=>r.to.toLowerCase()===toUser.toLowerCase()&&r.status==='pending')) return 'Request already sent';
  if(chats.find(c=>c.roomId===roomId)) return 'Chat already exists';
  try{
    await addDoc(collection(db,'requests'),{
      from:username,
      fromUid:currentUserUid,
      to:other.username,
      toUid:other.uid,
      participants:[currentUserUid,other.uid],
      status:'pending',
      createdAt:serverTimestamp()
    });
    return null;
  }
  catch(err){console.error(err);return 'Failed. Try again.';}
}
async function acceptRequest(reqId,fromUser){
  const reqSnap=await getDoc(doc(db,'requests',reqId)).catch(()=>null);
  const req=reqSnap?.exists()?reqSnap.data():null;
  if(isBlocked(fromUser)){await updateDoc(doc(db,'requests',reqId),{status:'declined'}).catch(()=>{});return;}
  const fromUid=req?.fromUid || (await getUserByUsername(fromUser))?.uid;
  if(!fromUid || !currentUserUid){showToast('Could not start chat','error');return;}
  await upsertRoomForChat(fromUid,fromUser);
  await updateDoc(doc(db,'requests',reqId),{status:'accepted'}).catch(()=>{});
  document.querySelector('[data-tab="chats"]').click();
  showToast(`Chat with ${fromUser} started!`,'success');
}
async function declineRequest(reqId){await updateDoc(doc(db,'requests',reqId),{status:'declined'}).catch(()=>{});}

function openModal(){modalOverlay.classList.add('open');newChatInput.value='';modalError.textContent='';sendRequestBtn.disabled=false;setTimeout(()=>newChatInput.focus(),300);}
const closeModal=()=>modalOverlay.classList.remove('open');
E('add-chat-empty-btn').addEventListener('click',openModal);
fabBtn.addEventListener('click',openModal);
E('modal-cancel-btn').addEventListener('click',closeModal);
modalOverlay.addEventListener('click',e=>{if(e.target===modalOverlay)closeModal();});
sendRequestBtn.addEventListener('click',async()=>{
  const val=newChatInput.value.trim();
  if(!val||val.length<3){modalError.textContent='Min 3 characters';return;}
  if(!/^[a-zA-Z0-9_]+$/.test(val)){modalError.textContent='Letters, numbers, underscore only';return;}
  if(getUsernameKey(val)===getUsernameKey(username)){modalError.textContent="Can't chat with yourself";return;}
  sendRequestBtn.disabled=true; sendRequestBtn.textContent='Sending…';
  const err=await sendChatRequest(val);
  sendRequestBtn.disabled=false; sendRequestBtn.textContent='Send Request';
  if(err){modalError.textContent=err;}else{closeModal();showToast(`Request sent to ${val}!`,'success');document.querySelector('[data-tab="requests"]').click();}
});
newChatInput.addEventListener('keydown',e=>{if(e.key==='Enter')sendRequestBtn.click();});

// ============== VOICE MESSAGING ==============
async function startRecording(){
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    mediaRecorder=new MediaRecorder(stream,{mimeType:'audio/webm'});
    audioChunks=[];
    mediaRecorder.ondataavailable=e=>{if(e.data.size>0)audioChunks.push(e.data);};
    mediaRecorder.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());
      const blob=new Blob(audioChunks,{type:'audio/webm'});
      const reader=new FileReader();
      reader.onload=()=>sendMessageData(null,reader.result,false,true);
      reader.readAsDataURL(blob);
    };
    mediaRecorder.start();
    recordingSeconds=0;
    updateRecordingTimer();
    recordingTimer=setInterval(()=>{recordingSeconds++;updateRecordingTimer();},1000);
    voiceRecordingUI.classList.add('active');
    micBtn.classList.add('recording');
  }catch(err){
    showToast('Microphone access denied','error');
  }
}

function stopRecording(){
  if(mediaRecorder&&mediaRecorder.state==='recording'){
    mediaRecorder.stop();
  }
  clearInterval(recordingTimer);
  voiceRecordingUI.classList.remove('active');
  micBtn.classList.remove('recording');
}

function cancelRecording(){
  if(mediaRecorder&&mediaRecorder.state==='recording'){
    mediaRecorder.onstop=()=>{};
    mediaRecorder.stop();
  }
  clearInterval(recordingTimer);
  audioChunks=[];
  voiceRecordingUI.classList.remove('active');
  micBtn.classList.remove('recording');
}

function updateRecordingTimer(){
  const mins=Math.floor(recordingSeconds/60);
  const secs=recordingSeconds%60;
  recordingTimerEl.textContent=`${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
}

// Hold to record
let micHoldTimer=null;
micBtn.addEventListener('mousedown',e=>{e.preventDefault();micHoldTimer=setTimeout(()=>startRecording(),200);});
micBtn.addEventListener('mouseup',()=>{clearTimeout(micHoldTimer);if(mediaRecorder?.state==='recording')stopRecording();});
micBtn.addEventListener('mouseleave',()=>{clearTimeout(micHoldTimer);if(mediaRecorder?.state==='recording')stopRecording();});
micBtn.addEventListener('touchstart',e=>{e.preventDefault();micHoldTimer=setTimeout(()=>startRecording(),200);});
micBtn.addEventListener('touchend',e=>{e.preventDefault();clearTimeout(micHoldTimer);if(mediaRecorder?.state==='recording')stopRecording();});
micBtn.addEventListener('touchcancel',()=>{clearTimeout(micHoldTimer);if(mediaRecorder?.state==='recording')cancelRecording();});

E('btn-send-recording').addEventListener('click',()=>{if(mediaRecorder?.state==='recording')stopRecording();});
E('btn-cancel-recording').addEventListener('click',cancelRecording);

// ============== SWIPE TO REPLY ==============
function attachSwipeListeners(row,msgData,isSent){
  row.addEventListener('touchstart',handleSwipeStart,{passive:false});
  row.addEventListener('touchmove',handleSwipeMove,{passive:false});
  row.addEventListener('touchend',e=>handleSwipeEnd(e,msgData,isSent));
  row.addEventListener('touchcancel',handleSwipeCancel);
}

function handleSwipeStart(e){
  swipeStartX=e.touches[0].clientX;
  swipeStartY=e.touches[0].clientY;
  swipeActive=false;
  currentSwipeRow=e.currentTarget;
}

function handleSwipeMove(e){
  if(!currentSwipeRow) return;
  const dx=e.touches[0].clientX-swipeStartX;
  const dy=e.touches[0].clientY-swipeStartY;
  if(Math.abs(dx)>Math.abs(dy)&&Math.abs(dx)>20){
    e.preventDefault();
    swipeActive=true;
    currentSwipeRow.style.transform=`translateX(${dx*0.4}px)`;
    const indicator=currentSwipeRow.querySelector('.swipe-reply-indicator');
    if(indicator){
      indicator.classList.toggle('active',Math.abs(dx)>swipeThreshold);
    }
  }
}

function handleSwipeEnd(e,msgData,isSent){
  if(!currentSwipeRow) return;
  const dx=(e.changedTouches[0]?.clientX||swipeStartX)-swipeStartX;
  currentSwipeRow.style.transform='';
  if(swipeActive&&Math.abs(dx)>swipeThreshold){
    replyTo={id:null,sender:msgData.sender,text:msgData.text,isImage:msgData.imageUrl};
    replyToName.textContent=msgData.sender;
    replyToText.textContent=msgData.imageUrl?'📷 Photo':msgData.text||'';
    replyBar.classList.add('show');
    setTimeout(()=>msgInput.focus(),100);
  }
  currentSwipeRow=null;
  swipeActive=false;
}

function handleSwipeCancel(){
  if(currentSwipeRow){
    currentSwipeRow.style.transform='';
  }
  currentSwipeRow=null;
  swipeActive=false;
}

function openCtxMenu(msgId,msgData,isSent){
  ctxMsgId=msgId; ctxMsgData=msgData;
  E('ctx-delete').style.display=isSent?'flex':'none';
  E('ctx-copy').style.display=msgData.imageUrl||msgData.voiceUrl?'none':'flex';
  const wrap=E('ctx-wrap-inner');
  wrap.className='ctx-wrap'+(isSent?'':' recv-ctx');
  const clone=E('ctx-bubble-clone');
  clone.className='ctx-bubble-preview'+(isSent?'':' recv');
  clone.textContent=msgData.voiceUrl?'🎤 Voice message':msgData.imageUrl?'📷 Photo':(msgData.text||'');
  ctxOverlay.classList.add('open');
}
function closeCtxMenu(){ctxOverlay.classList.remove('open');reactionPickerOverlay.classList.remove('open');ctxMsgId=null;ctxMsgData=null;}
ctxOverlay.addEventListener('click',e=>{if(e.target===ctxOverlay)closeCtxMenu();});
E('ctx-reply').addEventListener('click',()=>{
  if(!ctxMsgData) return;
  replyTo={id:ctxMsgId,sender:ctxMsgData.sender,text:ctxMsgData.text,isImage:ctxMsgData.imageUrl};
  replyToName.textContent=ctxMsgData.sender;
  replyToText.textContent=ctxMsgData.imageUrl?'📷 Photo':(ctxMsgData.text||'');
  replyBar.classList.add('show'); closeCtxMenu(); setTimeout(()=>msgInput.focus(),100);
});
E('ctx-react').addEventListener('click',()=>{
  ctxOverlay.classList.remove('open');
  reactionPickerOverlay.classList.add('open');
});
E('ctx-copy').addEventListener('click',()=>{
  if(ctxMsgData?.text){navigator.clipboard.writeText(ctxMsgData.text).then(()=>showToast('Copied'));}
  closeCtxMenu();
});
E('ctx-delete').addEventListener('click',async()=>{
  if(ctxMsgId&&activeChatId){await deleteDoc(doc(db,'rooms',activeChatId,'messages',ctxMsgId)).catch(()=>{});}
  closeCtxMenu();
});

reactionPickerOverlay.addEventListener('click',e=>{if(e.target===reactionPickerOverlay)closeCtxMenu();});
reactionPicker.querySelectorAll('button').forEach(btn=>{
  btn.addEventListener('click',()=>{
    if(ctxMsgId) addReaction(ctxMsgId,btn.dataset.emoji);
    closeCtxMenu();
  });
});
async function addReaction(msgId,emoji){
  const ref=doc(db,'rooms',activeChatId,'messages',msgId);
  const snap=await getDoc(ref); if(!snap.exists()) return;
  const data=snap.data(),reactions=data.reactions||{};
  if(!reactions[emoji]) reactions[emoji]=[];
  const idx=reactions[emoji].indexOf(username);
  if(idx>-1) reactions[emoji].splice(idx,1); else reactions[emoji].push(username);
  if(!reactions[emoji].length) delete reactions[emoji];
  await updateDoc(ref,{reactions}).catch(()=>{});
}

// Voice waveform animation
function createWaveformBars(container){
  container.innerHTML='';
  for(let i=0;i<20;i++){
    const bar=document.createElement('div');
    bar.className='bar';
    bar.style.height=`${Math.random()*24+4}px`;
    container.appendChild(bar);
  }
}

async function deleteExpiredMessageDoc(roomId,msgId){
  if(!roomId||!msgId) return;
  await deleteDoc(doc(db,'rooms',roomId,'messages',msgId)).catch(()=>{});
}
async function cleanupExpiredMessages(roomId=activeChatId){
  if(!roomId) return;
  try{
    const participants=getRoomParticipants(roomId);
    const snap=await getDocs(collection(db,'rooms',roomId,'messages'));
    const deletions=[];
    snap.docs.forEach(ds=>{
      if(shouldDeleteAutoDeleteMessage(ds.data(),participants) || isExpiredMessage(ds.data())) deletions.push(deleteExpiredMessageDoc(roomId,ds.id));
    });
    if(deletions.length) await Promise.all(deletions);
  }catch(err){console.warn('Expired cleanup failed',err);}
}
async function cleanupAllKnownChats(){
  const knownChats=loadChats();
  await Promise.all(knownChats.map(chat=>cleanupExpiredMessages(chat.roomId)));
  renderChats(searchInput?.value?.trim().toLowerCase()||'');
}

function listenForMessages(roomId){
  if(unsubMessages) unsubMessages();
  messagesRenderSeq++;
  cleanupExpiredMessages(roomId);
  const q=query(collection(db,'rooms',roomId,'messages'),orderBy('timestamp','asc'));
  unsubMessages=onSnapshot(q,async snap=>{
    const renderSeq=++messagesRenderSeq;
    const decryptedDocs=[];
    const messagesToMarkViewed=[];
    const messagesToMarkReceivedAndSeen=[];
    const seenDocIds=new Set();
    const participants=getRoomParticipants(roomId);
    for(const ds of snap.docs){
      if(renderSeq!==messagesRenderSeq || activeChatId!==roomId) return;
      if(seenDocIds.has(ds.id)) continue;
      seenDocIds.add(ds.id);
      const raw=ds.data();
      if(shouldDeleteAutoDeleteMessage(raw,participants) || isExpiredMessage(raw)){
        deleteExpiredMessageDoc(roomId,ds.id);
        continue;
      }
      const msg=await decryptMessageData(raw,roomId);
      if(renderSeq!==messagesRenderSeq || activeChatId!==roomId) return;
      if(raw.systemAutoDelete || msg.systemAutoDelete || /selected auto-delete|turned off auto-delete/i.test(String(msg.text||''))){
        continue;
      }
      if(shouldDeleteAutoDeleteMessage(msg,participants) || isExpiredMessage(msg)){
        deleteExpiredMessageDoc(roomId,ds.id);
        continue;
      }
      if(isHiddenForCurrentUser(msg)) continue;
      decryptedDocs.push({id:ds.id,msg,raw});
      messagesToMarkViewed.push({id:ds.id,msg});
      if(!isCurrentUserSender(msg)){
        messagesToMarkReceivedAndSeen.push({id:ds.id,msg});
      }
    }
    if(renderSeq!==messagesRenderSeq || activeChatId!==roomId) return;
    const renderableDocs=decryptedDocs.filter(entry=>entry.msg?.type!=='system');
    messagesWrap.innerHTML='';
    if(!renderableDocs.length){
      const el=document.createElement('div');
      el.style.cssText='text-align:center;padding:60px 20px;';
      el.innerHTML=`<div style="display:inline-block;background:rgba(18,23,30,0.9);color:#00c9a7;font-size:.8rem;padding:8px 16px;border-radius:20px;backdrop-filter:blur(4px);border:1px solid rgba(0, 201, 167, 0.3);">Messages are end-to-end encrypted</div>`;
      messagesWrap.appendChild(el); return;
    }
    let lastDate=null;
    renderableDocs.forEach((entry,i)=>{
      const msg=entry.msg;
      const msgDate=msg.timestamp?fmtDate(msg.timestamp):'Today';
      if(msgDate!==lastDate){
        const sep=document.createElement('div');
        sep.className='date-sep';
        sep.dataset.date=msgDate;
        sep.innerHTML=`<span>${msgDate}</span>`;
        messagesWrap.appendChild(sep);
        lastDate=msgDate;
      }
      const isSent=isCurrentUserSender(msg);
      const nextMsg=renderableDocs[i+1]?.msg;
      const isLast=!nextMsg||nextMsg.sender!==msg.sender;
      const row=document.createElement('div');
      row.className=`msg-row ${isSent?'sent':'recv'}${isLast?(isSent?' tail-sent':' tail-recv'):''}`;
      
      // Swipe reply indicator
      const swipeIndicator=document.createElement('div');
      swipeIndicator.className='swipe-reply-indicator';
      swipeIndicator.innerHTML=`<svg viewBox="0 0 24 24"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg> Reply`;
      row.appendChild(swipeIndicator);
      
      let replyHtml='';
      if(msg.replyTo){
        replyHtml=`<div class="reply-preview"><div class="reply-preview-name">${esc(msg.replyTo.sender)}</div><div class="reply-preview-text">${msg.replyTo.isImage?'📷 Photo':esc(msg.replyTo.text||'')}</div></div>`;
      }
      const rxns=msg.reactions||{};
      const reactionHtml=Object.keys(rxns).length?`<div class="reactions">${Object.entries(rxns).map(([e,users])=>`<span class="reaction-pill${users.includes(username)?' mine':''}" data-msg="${entry.id}" data-emoji="${e}">${e} ${users.length}</span>`).join('')}</div>`:'';
      const expiryHtml=msg.autoDeleteMode?`<span title="Auto-delete: ${getAutoDeleteLabel(msg.autoDeleteMode)}" style="margin-right:4px;">⏱</span>`:'';
      const receiptHtml=isSent?getMessageReceiptStatusHtml(msg,roomId):'';
      const timeHtml=`<span class="bubble-meta">${expiryHtml}${fmtTime(msg.timestamp)}${receiptHtml}</span>`;
      
      if(msg.voiceUrl){
        // Voice message bubble
        if(!isSent){
          row.innerHTML+=`<div class="bubble-outer">${i===0||renderableDocs[i-1]?.msg.sender!==msg.sender?`<div class="msg-sender-name">${esc(msg.sender||'')}</div>`:''}<div class="bubble"><div class="voice-msg" data-audio="${esc(msg.voiceUrl)}"><button class="voice-play-btn"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></button><div class="voice-waveform"></div><span class="voice-duration">0:00</span></div>${timeHtml}</div>${reactionHtml}</div>`;
        } else {
          row.innerHTML+=`<div class="bubble-outer"><div class="bubble"><div class="voice-msg" data-audio="${esc(msg.voiceUrl)}"><button class="voice-play-btn"><svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></button><div class="voice-waveform"></div><span class="voice-duration">0:00</span></div>${timeHtml}</div>${reactionHtml}</div>`;
        }
      } else if(msg.imageUrl){
        row.innerHTML+=`<div class="bubble-outer"><div class="msg-image-wrap">${replyHtml}<img class="msg-image" src="${esc(msg.imageUrl)}" alt=""/><div style="padding:4px 8px 6px;">${timeHtml}</div></div>${reactionHtml}</div>`;
      } else {
        if(!isSent){
          row.innerHTML+=`<div class="bubble-outer">${i===0||renderableDocs[i-1]?.msg.sender!==msg.sender?`<div class="msg-sender-name">${esc(msg.sender||'')}</div>`:''}<div class="bubble">${replyHtml}${esc(msg.text||'')}${timeHtml}</div>${reactionHtml}</div>`;
        } else {
          row.innerHTML+=`<div class="bubble-outer"><div class="bubble">${replyHtml}${esc(msg.text||'')}${timeHtml}</div>${reactionHtml}</div>`;
        }
      }
      
      const mainEl=row.querySelector('.bubble,.msg-image,.voice-msg');
      if(mainEl){
        let pressTimer;
        const openCtx=()=>openCtxMenu(entry.id,msg,isSent);
        mainEl.addEventListener('mousedown',()=>{pressTimer=setTimeout(openCtx,500);});
        mainEl.addEventListener('mouseup',()=>clearTimeout(pressTimer));
        mainEl.addEventListener('mouseleave',()=>clearTimeout(pressTimer));
        mainEl.addEventListener('touchstart',()=>{pressTimer=setTimeout(openCtx,500);},{passive:true});
        mainEl.addEventListener('touchend',()=>clearTimeout(pressTimer));
        mainEl.addEventListener('contextmenu',e=>{e.preventDefault();openCtx();});
      }
      
      // Attach swipe listeners
      attachSwipeListeners(row,msg,isSent);
      
      row.querySelectorAll('.msg-image').forEach(img=>{img.addEventListener('click',()=>openImageViewer(img.src));});
      row.querySelectorAll('[data-emoji]').forEach(pill=>{pill.addEventListener('click',()=>addReaction(pill.dataset.msg,pill.dataset.emoji));});
      
      // Voice play buttons
      row.querySelectorAll('.voice-msg').forEach(vm=>{
        const audioUrl=vm.dataset.audio;
        const waveform=vm.querySelector('.voice-waveform');
        createWaveformBars(waveform);
        const playBtn=vm.querySelector('.voice-play-btn');
        const durationEl=vm.querySelector('.voice-duration');
        
        playBtn.addEventListener('click',()=>{
          if(currentAudio&&!currentAudio.paused){
            currentAudio.pause();
            currentAudio=null;
            vm.classList.remove('playing');
            playBtn.innerHTML='<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>';
            return;
          }
          if(currentAudio){
            currentAudio.pause();
            document.querySelectorAll('.voice-msg.playing').forEach(el=>{
              el.classList.remove('playing');
              el.querySelector('.voice-play-btn').innerHTML='<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>';
            });
          }
          const audio=new Audio(audioUrl);
          currentAudio=audio;
          vm.classList.add('playing');
          playBtn.innerHTML='<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
          
          audio.addEventListener('loadedmetadata',()=>{
            const m=Math.floor(audio.duration/60);
            const s=Math.floor(audio.duration%60);
            durationEl.textContent=`${m}:${String(s).padStart(2,'0')}`;
          });
          
          // Animate waveform during playback
          let animFrame;
          const animateWave=()=>{
            if(!audio.paused){
              waveform.querySelectorAll('.bar').forEach(bar=>{
                bar.style.height=`${Math.random()*24+4}px`;
              });
              animFrame=requestAnimationFrame(animateWave);
            }
          };
          audio.addEventListener('play',animateWave);
          audio.addEventListener('ended',()=>{
            vm.classList.remove('playing');
            playBtn.innerHTML='<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>';
            cancelAnimationFrame(animFrame);
            currentAudio=null;
          });
          audio.addEventListener('pause',()=>{
            vm.classList.remove('playing');
            playBtn.innerHTML='<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg>';
            cancelAnimationFrame(animFrame);
            currentAudio=null;
          });
          audio.play().catch(()=>{});
        });
      });
      
      messagesWrap.appendChild(row);
    });
    const idx=chats.findIndex(c=>c.roomId===roomId);
    if(idx!==-1&&chats[idx].unread>0){chats[idx].unread=0;saveChats(chats);renderChats();}
    const latest=renderableDocs[renderableDocs.length-1]?.msg;
    if(latest&&idx!==-1){
      chats[idx].preview=latest.voiceUrl?'🎤 Voice message':latest.imageUrl?'📷 Photo':(latest.text||'');
      chats[idx].isVoice=!!latest.voiceUrl;
      chats[idx].isImage=!!latest.imageUrl&&!latest.voiceUrl;
      chats[idx].time=latest.timestamp?fmtTime(latest.timestamp):chats[idx].time;
      saveChats(chats); renderChats(searchInput?.value?.trim().toLowerCase()||'');
    }
    messagesToMarkViewed.forEach(({id,msg})=>{
      markMessageViewed(roomId,id,msg).catch(()=>{});
    });
    messagesToMarkReceivedAndSeen.forEach(({id,msg})=>{
      markMessageReceivedAndSeen(roomId,id,msg).catch(()=>{});
    });
    messagesWrap.scrollTop=messagesWrap.scrollHeight;
  },err=>{console.error(err);showToast('Could not load messages','error');});
}

async function setTyping(on){
  if(!activeChatId||!username) return;
  try{
    if(on) await setDoc(doc(db,'rooms',activeChatId),{[`typing_${username}`]:true},{merge:true});
    else await updateDoc(doc(db,'rooms',activeChatId),{[`typing_${username}`]:deleteField()}).catch(()=>{});
  }catch{}
}
function listenForTyping(roomId,other){
  return onSnapshot(doc(db,'rooms',roomId),snap=>{
    const d=snap.data()||{};
    if(activeChat?.roomId===roomId){
      activeChat.autoDelete=d.autoDelete||null;
      activeChat.autoDeleteMode=normalizeAutoDeleteMode(d.autoDelete?.mode);
    }
    const idx=chats.findIndex(c=>c.roomId===roomId);
    if(idx!==-1){
      chats[idx].autoDelete=d.autoDelete||null;
      chats[idx].autoDeleteMode=normalizeAutoDeleteMode(d.autoDelete?.mode);
    }
    if(d[`typing_${other}`]){chStatus.textContent='typing...';typingIndicator.classList.add('show');}
    else{typingIndicator.classList.remove('show');updateChatHeaderStatus();}
  });
}

function openChat(chat){
  if(Array.isArray(chat.participants) && currentUserUid && !chat.participants.includes(currentUserUid)){
    showToast('You do not have access to this chat','error');
    return;
  }
  activeChat=chat; activeChatId=chat.roomId;
  const c=getColor(chat.name);
  chAvatar.textContent=chat.name[0].toUpperCase();
  chAvatar.style.background=c;
  chName.textContent=chat.name;
  updateChatHeaderStatus();
  cleanupExpiredMessages(chat.roomId);
  listenForMessages(chat.roomId);
  if(unsubTyping) unsubTyping();
  unsubTyping=listenForTyping(chat.roomId,chat.name);
  chatScreen.classList.add('active');
  requestAnimationFrame(()=>chatScreen.classList.add('slide-in'));
  updateBlockedChatUI();
  // Stop any playing audio
  if(currentAudio){currentAudio.pause();currentAudio=null;}
}
function closeChat(){
  const closingRoomId=activeChatId;
  setTyping(false); clearReply(); closeCtxMenu();
  if(currentAudio){currentAudio.pause();currentAudio=null;}
  if(mediaRecorder?.state==='recording') cancelRecording();
  if(unsubMessages){unsubMessages();unsubMessages=null;}
  if(unsubTyping){unsubTyping();unsubTyping=null;}
  if(getRoomAutoDelete(closingRoomId)==='after_viewing') markAfterViewingExit(closingRoomId);
  document.body.classList.remove('chat-is-blocked');
  chatScreen.classList.remove('slide-in');
  setTimeout(()=>{chatScreen.classList.remove('active');activeChatId=null;activeChat=null;typingIndicator.classList.remove('show');chStatus.textContent='offline';updateBlockedChatUI();},300);
}
backBtn.addEventListener('click',closeChat);

const clearReply=()=>{replyTo=null;replyBar.classList.remove('show');};
replyBarClose.addEventListener('click',clearReply);

E('img-upload').addEventListener('change',async e=>{
  if(activeChat && isBlocked(activeChat.name)){e.target.value='';updateBlockedChatUI();showToast('Unblock this account to send messages','error');return;}
  const file=e.target.files[0]; if(!file) return;
  if(file.size>5*1024*1024){showToast('Image too large (max 5MB)','error');return;}
  const reader=new FileReader();
  reader.onload=async ev=>{ await sendMessageData(null,ev.target.result,true); };
  reader.readAsDataURL(file); e.target.value='';
});

msgInput.addEventListener('input',()=>{
  msgInput.style.height='auto'; msgInput.style.height=Math.min(msgInput.scrollHeight,120)+'px';
  sendBtn.disabled=!msgInput.value.trim();
  setTyping(true); clearTimeout(typingTimeout); typingTimeout=setTimeout(()=>setTyping(false),2000);
});
msgInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!sendBtn.disabled)sendMessage();}});
sendBtn.addEventListener('click',sendMessage);
function sendMessage(){
  if(activeChat && isBlocked(activeChat.name)){updateBlockedChatUI();showToast('Unblock this account to send messages','error');return;}
  const text=msgInput.value.trim(); if(!text||!activeChatId) return;
  msgInput.value=''; msgInput.style.height='auto'; sendBtn.disabled=true;
  sendMessageData(text,null,false,false);
}
async function sendMessageData(text,imageUrl,isImage,isVoice){
  if(!activeChatId) return;
  if(activeChat && isBlocked(activeChat.name)){updateBlockedChatUI();showToast('Unblock this account to send messages','error');return;}
  setTyping(false); clearTimeout(typingTimeout);
  const messageData={};
  if(text) messageData.text=text;
  if(imageUrl&&isVoice) messageData.voiceUrl=imageUrl;
  else if(imageUrl) messageData.imageUrl=imageUrl;
  if(replyTo) messageData.replyTo={sender:replyTo.sender,text:replyTo.text||'',isImage:!!replyTo.isImage};
  const expiryFields=getMessageAutoDeleteFields(activeChatId);
  clearReply();
  try{
    const encryptedPayload=E2EE_ENABLED?await encryptMessageData(messageData,activeChatId):messageData;
    const payload={
      sender:username,
      senderUid:currentUserUid||'',
      timestamp:serverTimestamp(),
      type:isVoice?'voice':isImage?'image':'text',
      deliveredTo:{},
      deliveredAtBy:{},
      seenBy:{},
      seenAtBy:{},
      ...expiryFields,
      ...encryptedPayload
    };
    await addDoc(collection(db,'rooms',activeChatId,'messages'),payload);
    await setDoc(doc(db,'rooms',activeChatId),{
      lastMessagePreview:text||(isVoice?'🎤 Voice message':isImage?'📷 Photo':''),
      lastMessageType:isVoice?'voice':isImage?'image':'text',
      lastMessageSenderUid:currentUserUid||'',
      updatedAt:serverTimestamp()
    },{merge:true}).catch(()=>{});
    await cleanupExpiredMessages(activeChatId);
    const idx=chats.findIndex(c=>c.roomId===activeChatId);
    if(idx!==-1){
      chats[idx].preview=text||(isVoice?'🎤 Voice message':isImage?'📷 Photo':''); 
      chats[idx].isVoice=isVoice; chats[idx].isImage=isImage&&!isVoice;
      chats[idx].time=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      const [item]=chats.splice(idx,1); chats.unshift(item); saveChats(chats); renderChats();
    }
  }catch(err){console.error(err);showToast('Message failed','error');}
}

function openImageViewer(src){E('img-viewer-img').src=src;E('img-viewer').classList.add('open');}
E('img-viewer-close').addEventListener('click',()=>{E('img-viewer').classList.remove('open');E('img-viewer-img').src='';});


E('blocked-unblock-btn')?.addEventListener('click',()=>{
  if(activeChat) removeFromBlockList(activeChat.name);
});
E('blocked-delete-chat-btn')?.addEventListener('click',()=>{
  if(!activeChat) return;
  const name=activeChat.name;
  chats=chats.filter(c=>c.roomId!==activeChatId && c.name.toLowerCase()!==name.toLowerCase());
  saveChats(chats);
  closeChat();
  renderChats(searchInput?.value?.trim().toLowerCase()||'');
  showToast('Chat deleted','success');
});

document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    E('tab-'+tab.dataset.tab).classList.add('active');
  });
});

E('menu-trigger-btn').addEventListener('click',()=>menuOverlay.classList.add('open'));
menuOverlay.addEventListener('click',e=>{if(e.target===menuOverlay)menuOverlay.classList.remove('open');});
E('menu-change-username').addEventListener('click',()=>{
  E('new-username-input').value=username; E('username-change-error').textContent='';
  E('change-username-modal').classList.add('open'); menuOverlay.classList.remove('open');
});
E('cancel-username-btn').addEventListener('click',()=>E('change-username-modal').classList.remove('open'));
E('confirm-username-btn').addEventListener('click',()=>{
  const val=E('new-username-input').value.trim();
  const err=validateUsername(val); if(err){E('username-change-error').textContent=err;return;}
  const oldKey=getUsernameKey(username),newKey=getUsernameKey(val);
  if(newKey===oldKey){E('username-change-error').textContent='Same as current username';return;}
  const users=loadUsers();
  if(users[newKey]){E('username-change-error').textContent='Username already taken';return;}
  const u=users[oldKey]; if(!u){E('username-change-error').textContent='Account not found';return;}
  u.username=val; delete users[oldKey]; users[newKey]=u;
  saveUsers(users); setCurrentUser(val); username=val; menuUsername.textContent=username;
  E('menu-avatar-letter').textContent=username[0].toUpperCase();
  updateCurrentUserPresence('online'); refreshPresenceUI();
  E('change-username-modal').classList.remove('open'); showToast('Username updated!','success');
  if(unsubRequests) unsubRequests(); listenForRequests();
});
E('change-username-modal').addEventListener('click',e=>{if(e.target===E('change-username-modal'))E('change-username-modal').classList.remove('open');});
E('menu-change-password').addEventListener('click',()=>{
  ['old-password-input','new-password-input','confirm-new-password-input'].forEach(id=>E(id).value='');
  E('password-change-error').textContent='';
  E('change-password-modal').classList.add('open'); menuOverlay.classList.remove('open');
});
E('cancel-password-btn').addEventListener('click',()=>E('change-password-modal').classList.remove('open'));
E('confirm-password-btn').addEventListener('click',async()=>{
  const err=await changePassword(username,E('old-password-input').value,E('new-password-input').value,E('confirm-new-password-input').value);
  if(err){E('password-change-error').textContent=err;return;}
  E('change-password-modal').classList.remove('open'); showToast('Password changed!','success');
});
E('menu-block-list').addEventListener('click',()=>{renderBlockList();E('block-list-modal').classList.add('open');menuOverlay.classList.remove('open');});
E('close-blocklist-btn').addEventListener('click',()=>E('block-list-modal').classList.remove('open'));
function renderBlockList(){
  const bl=E('block-list-content');
  if(!blockedUsers.length){bl.innerHTML='<div style="text-align:center;color:var(--text-secondary);padding:32px 0;font-size:.88rem;">No blocked users</div>';return;}
  bl.innerHTML=blockedUsers.map(u=>`<div class="block-user-row"><span style="font-size:.92rem;">${esc(u)}</span><button class="btn-unblock" data-unblock="${esc(u)}">Unblock</button></div>`).join('');
  bl.querySelectorAll('[data-unblock]').forEach(b=>b.addEventListener('click',()=>removeFromBlockList(b.dataset.unblock)));
}
E('menu-delete-account').addEventListener('click',()=>{
  E('delete-confirm-password').value=''; E('delete-account-error').textContent='';
  E('delete-account-modal').classList.add('open'); menuOverlay.classList.remove('open');
});
E('delete-account-cancel').addEventListener('click',()=>E('delete-account-modal').classList.remove('open'));
E('delete-account-confirm').addEventListener('click',async()=>{
  const ok=await deleteAccountFn(username,E('delete-confirm-password').value);
  if(!ok){E('delete-account-error').textContent='Incorrect password';return;}
  E('delete-account-modal').classList.remove('open');
  showToast('Account deleted','success'); setTimeout(()=>window.location.reload(),1500);
});
E('menu-logout').addEventListener('click',async()=>{
  menuOverlay.classList.remove('open');
  if(confirm('Log out?')){
    await updateCurrentUserPresence('offline');
    stopStatusRefresh();
    stopPresenceListener();
    if(unsubRequests){unsubRequests();unsubRequests=null;}
    if(unsubMessages){unsubMessages();unsubMessages=null;}
    if(unsubTyping){unsubTyping();unsubTyping=null;}
    stopRoomListener();
    await signOut(auth).catch(()=>{});
    setCurrentUser(null);
    username='';
    currentUserUid=null;
    chats=[]; incomingReqs=[]; sentReqs=[]; blockedUsers=[];
    renderChats();
    mainScreen.classList.remove('active'); loginScreen.classList.add('active');
  }
});



function updateAppViewportHeight(){
  const vv=window.visualViewport;
  const h=vv?vv.height:window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(h)}px`);
}

updateAppViewportHeight();
window.addEventListener('resize',updateAppViewportHeight);
window.addEventListener('orientationchange',updateAppViewportHeight);
if(window.visualViewport){
  window.visualViewport.addEventListener('resize',updateAppViewportHeight);
  window.visualViewport.addEventListener('scroll',updateAppViewportHeight);
}

document.querySelectorAll('.password-toggle').forEach(btn=>{
  btn.addEventListener('click',function(){
    const t=document.getElementById(this.dataset.target); if(!t) return;
    const isHidden=t.type==='password'; t.type=isHidden?'text':'password';
    const svg=this.querySelector('svg path');
    if(svg) svg.setAttribute('d',isHidden?'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z':'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z');
  });
});

E('signup-username').addEventListener('input',function(){
  const err=validateEmail(this.value),h=E('signup-username-helper');
  if(err&&this.value){this.classList.add('error');this.classList.remove('valid');h.textContent=err;h.style.color='var(--danger)';}
  else if(!err&&this.value){this.classList.remove('error');this.classList.add('valid');h.textContent='Email looks good!';h.style.color='var(--accent-primary)';}
  else{this.classList.remove('error','valid');h.textContent='Use a valid email address.';h.style.color='';}
});
E('signup-password').addEventListener('input',function(){
  const err=validatePassword(this.value),h=E('signup-password-helper');
  if(err&&this.value){this.classList.add('error');this.classList.remove('valid');h.textContent=err;h.style.color='var(--danger)';}
  else if(!err){this.classList.remove('error');this.classList.add('valid');h.textContent='Strong enough!';h.style.color='var(--accent-primary)';}
});
E('signup-confirm').addEventListener('input',function(){
  if(this.value!==E('signup-password').value){this.classList.add('error');this.classList.remove('valid');}
  else if(this.value){this.classList.remove('error');this.classList.add('valid');}
});


document.addEventListener('visibilitychange',()=>{
  if(!username) return;
  if(document.visibilityState==='visible'){
    updateCurrentUserPresence('online');
    refreshPresenceUI();
  }else{
    updateCurrentUserPresence('offline');
  }
});
window.addEventListener('pagehide',()=>{
  if(!username) return;
  updateCurrentUserPresence('offline');
});
window.addEventListener('beforeunload',()=>{
  if(!username) return;
  updateCurrentUserPresence('offline');
});

onAuthStateChanged(auth,async(user)=>{
  if(user){
    currentUserUid=user.uid;
    const profile=await getExistingFirebaseProfile(user);
    if(profile?.username){
      username=profile.username;
      setCurrentUser(username);
      initMainScreen();
    }else{
      showUsernameSetup(user);
    }
  }else{
    if(unsubMessages){unsubMessages();unsubMessages=null;}
    if(unsubTyping){unsubTyping();unsubTyping=null;}
    if(unsubRequests){unsubRequests();unsubRequests=null;}
    stopRoomListener();
    stopPresenceListener();
    stopStatusRefresh();
    username='';
    currentUserUid=null;
    chats=[];
    activeChatId=null;
    activeChat=null;
    setCurrentUser(null);
    renderChats();
    mainScreen.classList.remove('active');
    usernameSetupScreen.classList.remove('active');
    loginScreen.classList.add('active');
  }
});