import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin, Mic, X, Trash2, Check, Navigation, Map,
  Compass, Mountain, Share2, Copy, Send, Camera, Pencil,
  Search, Sparkles, ArrowUp, BookOpen, RefreshCw, LogOut
} from "lucide-react";
import {
  signUp as sbSignUp, signIn as sbSignIn, signOut as sbSignOut,
  getCurrentUser, onAuthChange,
  fetchPlaces, createPlace, updatePlace, deletePlace as sbDeletePlace,
  callAsk
} from "./lib/supabase.js";

const CATEGORIES = {
  food: { label: "Food & Drink", color: "#C44818", soft: "#F4DDCB", emoji: "\u{1F374}",
    keywords: ["restaurant","cafe","coffee","eat","food","drink","bar","brunch","dinner","lunch","breakfast","bakery","pizza","taco","burger","noodles","ramen","sushi","wine","brewery","cocktail","diner","ice cream","pastry"] },
  nature: { label: "Trails & Nature", color: "#3F5C2E", soft: "#DCE5D1", emoji: "\u{1F332}",
    keywords: ["waterfall","mountain","trail","hike","beach","park","forest","lake","river","view","vista","creek","spring","canyon","valley","peak","summit","ocean","tide","meadow","wildflower","tree","swimming hole","overlook","scenic"] },
  camping: { label: "Camping", color: "#5C4530", soft: "#E8DCC8", emoji: "\u{26FA}",
    keywords: ["camp","campsite","tent","fire","cabin","hot spring","boondock","rv","dispersed"] },
  shop: { label: "Shops", color: "#7A4E6B", soft: "#EBDBE5", emoji: "\u{1F6CD}",
    keywords: ["shop","store","market","boutique","thrift","vintage","bookstore","record"] },
  city: { label: "City", color: "#3A6079", soft: "#D6E1EB", emoji: "\u{1F3D9}",
    keywords: ["plaza","bridge","downtown","rooftop","museum","gallery","club","venue","theater","mural","art"] },
  default: { label: "Places", color: "#B5832A", soft: "#F1E3BF", emoji: "\u{1F4CD}", keywords: [] }
};
const CATEGORY_ORDER = ["nature","camping","food","city","shop","default"];

const DEMO_LOCATIONS = [
  { lat: 34.4480, lng: -119.2429, label: "Ojai, CA" },
  { lat: 36.0544, lng: -112.1401, label: "Grand Canyon" },
  { lat: 40.7580, lng: -73.9855, label: "Times Square" }
];

const SUGGESTED_PROMPTS = [
  "What's near me?",
  "Plan a small day trip",
  "A good food spot",
  "Somewhere quiet in nature"
];

function categorize(text) {
  const lower = (text || "").toLowerCase();
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    if (key === "default") continue;
    if (cat.keywords.some((kw) => lower.includes(kw))) return key;
  }
  return "default";
}
function getCategoryKey(p) { return p.categoryOverride || p.category || categorize(p.name); }
function timeAgo(ts) {
  const d = Date.now() - ts, m = Math.floor(d/60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h/24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function formatDistance(m) {
  if (m == null || isNaN(m)) return null;
  if (m < 0.1) return "<0.1 mi";
  if (m < 10) return `${m.toFixed(1)} mi`;
  return `${Math.round(m)} mi`;
}
function isValidEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || "").trim()); }
function initialsOf(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

async function compressImage(file, maxW = 1000, q = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * s), h = Math.round(img.height * s);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", q));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function generateTitleFromTranscript(transcript, location) {
  const system = `You convert raw spoken descriptions of places into clean, short titles for a "save this place" app.

Respond with VALID JSON ONLY, no markdown fences, no preamble:
{
  "title": "<2-6 word clean title>",
  "notes": "<extra context from what they said, or empty string>",
  "category": "<food | nature | camping | shop | city | default>"
}

TITLE RULES:
- Maximum 6 words. Title case.
- Include the landmark or place name they mentioned (Ojai, Mt. Tam, etc.)
- Use a hyphen for sub-title when there is descriptive detail
- No periods, no quotes

EXAMPLES:
"It's a waterfall near Ojai" -> {"title":"Ojai Waterfall","notes":"","category":"nature"}
"A big waterfall with a short hike near Ojai" -> {"title":"Ojai Waterfall - Short Hike","notes":"Big waterfall, short hike","category":"nature"}
"This is the best taco spot in the mission" -> {"title":"Mission Tacos","notes":"Best in the neighborhood","category":"food"}
"um my favorite coffee place on third street" -> {"title":"Third Street Coffee","notes":"Favorite spot","category":"food"}`;

  const userMsg = `Raw transcript: "${transcript}"
Approximate location: ${location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : "unknown"}`;

  try {
    const data = await callAsk({ system, messages: [{ role: "user", content: userMsg }], max_tokens: 300 });
    const text = (data.content || []).map((c) => c.type === "text" ? c.text : "").join("").trim();
    const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(clean);
    if (parsed.title && typeof parsed.title === "string") return parsed;
    throw new Error("invalid response");
  } catch (e) {
    const fallback = transcript.trim().split(/\s+/).slice(0, 6).join(" ");
    return { title: fallback.charAt(0).toUpperCase() + fallback.slice(1), notes: "", category: categorize(transcript) };
  }
}

const bg = { fontFamily: '"Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif', WebkitFontSmoothing: "antialiased", letterSpacing: "-0.015em" };
const topoPattern = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='600' viewBox='0 0 600 600'%3E%3Cg fill='none' stroke='%235C4530' stroke-width='1' opacity='0.18'%3E%3Cpath d='M-50,200 Q150,100 300,180 T650,170'/%3E%3Cpath d='M-50,240 Q150,140 300,220 T650,210'/%3E%3Cpath d='M-50,280 Q150,180 300,260 T650,250'/%3E%3Cpath d='M-50,320 Q150,220 300,300 T650,290'/%3E%3Cpath d='M-50,360 Q150,260 300,340 T650,330'/%3E%3Cpath d='M-50,400 Q150,300 300,380 T650,370'/%3E%3Cpath d='M-50,440 Q150,340 300,420 T650,410'/%3E%3Cpath d='M-50,480 Q150,380 300,460 T650,450'/%3E%3Cpath d='M-50,520 Q150,420 300,500 T650,490'/%3E%3Cpath d='M-50,560 Q150,460 300,540 T650,530'/%3E%3C/g%3E%3C/svg%3E\")";
const grainPattern = "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authForm, setAuthForm] = useState({ name: "", email: "", password: "", mode: "signup", error: "", busy: false });
  const [showProfile, setShowProfile] = useState(false);

  const [screen, setScreen] = useState("home");
  const [places, setPlaces] = useState([]);
  const [placesLoading, setPlacesLoading] = useState(false);

  // Voice save flow
  const [transcript, setTranscript] = useState("");
  const [savePhase, setSavePhase] = useState("idle");
  const [saveError, setSaveError] = useState("");
  const [generatedTitle, setGeneratedTitle] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualPhoto, setManualPhoto] = useState(null);
  const [manualMode, setManualMode] = useState(false);

  const [userLocation, setUserLocation] = useState(null);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [editingPlace, setEditingPlace] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", notes: "", categoryOverride: null });
  const [editPhoto, setEditPhoto] = useState(null);
  const [editPhotoChanged, setEditPhotoChanged] = useState(false);
  const [toast, setToast] = useState("");
  const [shareAppOpen, setShareAppOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [askInput, setAskInput] = useState("");
  const [askListening, setAskListening] = useState(false);
  const [askLoading, setAskLoading] = useState(false);
  const [askResponse, setAskResponse] = useState(null);
  const [askError, setAskError] = useState("");
  const [askLocationStatus, setAskLocationStatus] = useState("unknown");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [homeError, setHomeError] = useState("");

  const recognitionRef = useRef(null);
  const askRecognitionRef = useRef(null);
  const fileInputRef = useRef(null);
  const editFileInputRef = useRef(null);
  const captureLocationRef = useRef(null);
  const captureLocationDoneRef = useRef(false);
  const captureTranscriptRef = useRef("");
  const captureTranscriptDoneRef = useRef(false);
  const captureProcessedRef = useRef(false);
  const captureCancelledRef = useRef(false);

  // Bricolage Grotesque font
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300..800&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => { try { document.head.removeChild(link); } catch (e) {} };
  }, []);

  // Auth bootstrap and subscription
  useEffect(() => {
    (async () => {
      try {
        const u = await getCurrentUser();
        setCurrentUser(u);
      } catch (e) { console.error("auth bootstrap", e); }
      setAuthLoading(false);
    })();
    const { data: sub } = onAuthChange(async (session) => {
      if (session?.user) {
        try { setCurrentUser(await getCurrentUser()); } catch (e) {}
      } else {
        setCurrentUser(null);
      }
    });
    return () => { sub?.subscription?.unsubscribe?.(); };
  }, []);

  // Load this user's places when they sign in
  useEffect(() => {
    if (!currentUser) { setPlaces([]); return; }
    (async () => {
      setPlacesLoading(true);
      try {
        const rows = await fetchPlaces();
        setPlaces(rows);
      } catch (e) {
        console.error("fetch places", e);
        showToast("Couldn't load places");
      }
      setPlacesLoading(false);
    })();
  }, [currentUser?.id]);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  // ============ AUTH ============
  const doSignUp = async () => {
    const name = authForm.name.trim();
    const email = authForm.email.trim().toLowerCase();
    const password = authForm.password;
    if (!name) return setAuthForm((f) => ({ ...f, error: "Add your name." }));
    if (!isValidEmail(email)) return setAuthForm((f) => ({ ...f, error: "That email doesn't look right." }));
    if (!password || password.length < 6) return setAuthForm((f) => ({ ...f, error: "Password needs at least 6 characters." }));
    setAuthForm((f) => ({ ...f, busy: true, error: "" }));
    try {
      await sbSignUp({ email, password, name });
      // Supabase may require email confirmation depending on project settings.
      // If session is established immediately, the auth listener will populate currentUser.
      // If not, show a helpful message.
      const u = await getCurrentUser();
      if (u) {
        setCurrentUser(u);
        setAuthForm({ name: "", email: "", password: "", mode: "signup", error: "", busy: false });
      } else {
        setAuthForm((f) => ({ ...f, busy: false, error: "Account created. Check your email to confirm, then sign in.", mode: "signin" }));
      }
    } catch (e) {
      setAuthForm((f) => ({ ...f, busy: false, error: e.message || "Sign up failed." }));
    }
  };

  const doSignIn = async () => {
    const email = authForm.email.trim().toLowerCase();
    const password = authForm.password;
    if (!isValidEmail(email)) return setAuthForm((f) => ({ ...f, error: "That email doesn't look right." }));
    if (!password) return setAuthForm((f) => ({ ...f, error: "Enter your password." }));
    setAuthForm((f) => ({ ...f, busy: true, error: "" }));
    try {
      await sbSignIn({ email, password });
      const u = await getCurrentUser();
      setCurrentUser(u);
      setAuthForm({ name: "", email: "", password: "", mode: "signup", error: "", busy: false });
    } catch (e) {
      setAuthForm((f) => ({ ...f, busy: false, error: e.message || "Sign in failed." }));
    }
  };

  const doSignOut = async () => {
    try { await sbSignOut(); } catch (e) {}
    setCurrentUser(null);
    setShowProfile(false);
    setScreen("home");
    setSelectedPlace(null); setEditingPlace(null);
    setTranscript(""); setSavePhase("idle"); setSaveError("");
    setManualMode(false); setManualName(""); setManualNotes(""); setManualPhoto(null);
    setAskInput(""); setAskResponse(null); setAskError("");
  };

  // ============ VOICE SAVE FLOW ============
  const handleSavePress = () => {
    setHomeError("");
    setPermissionDenied(false);
    captureLocationRef.current = null;
    captureLocationDoneRef.current = false;
    captureTranscriptRef.current = "";
    captureTranscriptDoneRef.current = false;
    captureProcessedRef.current = false;
    captureCancelledRef.current = false;
    setTranscript("");
    setSaveError("");
    setGeneratedTitle("");
    setManualMode(false);
    setManualName("");
    setManualNotes("");
    setManualPhoto(null);

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setSavePhase("listening");
      setManualMode(true);
      setSaveError("Voice isn't supported on this browser. Type below.");
      setScreen("capturing");
      requestLocationInParallel();
      return;
    }

    try {
      const rec = new SR();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = "en-US";
      let finalText = "";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t; else interim += t;
        }
        const combined = (finalText + interim).trim();
        captureTranscriptRef.current = combined;
        setTranscript(combined);
      };
      rec.onerror = (ev) => {
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
          setSaveError("Mic permission denied. Type the name below.");
          setManualMode(true);
        } else if (ev.error === "no-speech") {
          setSaveError("I didn't catch anything. Try again or type.");
          setManualMode(true);
        }
      };
      rec.onend = () => { captureTranscriptDoneRef.current = true; tryProcessSave(); };
      rec.start();
      recognitionRef.current = rec;
    } catch (e) {
      setSaveError("Couldn't start voice. Type below.");
      setManualMode(true);
    }

    requestLocationInParallel();
    setSavePhase("listening");
    setScreen("capturing");
  };

  const requestLocationInParallel = () => {
    if (!navigator.geolocation) {
      captureLocationRef.current = { error: "Geolocation not supported" };
      captureLocationDoneRef.current = true;
      tryProcessSave();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        captureLocationRef.current = loc;
        captureLocationDoneRef.current = true;
        setUserLocation(loc);
        tryProcessSave();
      },
      (err) => {
        captureLocationRef.current = { error: err.message || "Couldn't get location" };
        captureLocationDoneRef.current = true;
        setPermissionDenied(true);
        tryProcessSave();
      },
      { enableHighAccuracy: true, timeout: 14000, maximumAge: 0 }
    );
  };

  const tryProcessSave = async () => {
    if (captureCancelledRef.current) return;
    if (captureProcessedRef.current) return;
    if (!captureLocationDoneRef.current || !captureTranscriptDoneRef.current) return;
    captureProcessedRef.current = true;

    const loc = captureLocationRef.current;
    const text = captureTranscriptRef.current;

    if (loc?.error) {
      setSavePhase("failed");
      setSaveError(loc.error.includes("denied") || loc.error.includes("permission")
        ? "Location permission denied."
        : "Couldn't get your location.");
      setPermissionDenied(true);
      return;
    }
    if (!text) {
      setSavePhase("listening");
      setManualMode(true);
      return;
    }
    setSavePhase("processing");
    const result = await generateTitleFromTranscript(text, loc);
    if (captureCancelledRef.current) return;
    setGeneratedTitle(result.title);
    await commitSave(result.title, result.notes, result.category, loc, null);
  };

  const commitSave = async (name, notes, categoryKey, loc, photo) => {
    try {
      const newPlace = await createPlace({
        name: name.trim(),
        notes: (notes || "").trim(),
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        category: categoryKey || categorize(name),
        categoryOverride: null,
        photo: photo || null
      });
      setPlaces((prev) => [newPlace, ...prev]);
      setScreen("saved");
      setTimeout(() => { setScreen("home"); setSavePhase("idle"); }, 1700);
    } catch (e) {
      console.error("commitSave failed", e);
      setSavePhase("failed");
      setSaveError("Couldn't save to your account: " + (e.message || "unknown"));
    }
  };

  const stopSpeechRecognition = () => {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch (e) {} }
  };

  const manualSubmitSave = async () => {
    if (!manualName.trim()) return;
    const loc = captureLocationRef.current;
    if (!loc || loc.error) { showToast("Still getting location. Hold on…"); return; }
    stopSpeechRecognition();
    setSavePhase("processing");
    await commitSave(manualName, manualNotes, null, loc, manualPhoto);
  };

  const retryListening = () => {
    setSaveError("");
    setSavePhase("listening");
    setTranscript("");
    captureTranscriptRef.current = "";
    captureTranscriptDoneRef.current = false;
    captureProcessedRef.current = false;
    setManualMode(false);

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setManualMode(true); return; }
    try {
      const rec = new SR();
      rec.continuous = false; rec.interimResults = true; rec.lang = "en-US";
      let finalText = "";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t; else interim += t;
        }
        const combined = (finalText + interim).trim();
        captureTranscriptRef.current = combined;
        setTranscript(combined);
      };
      rec.onerror = (ev) => { if (ev.error === "not-allowed") { setSaveError("Mic permission denied."); setManualMode(true); } };
      rec.onend = () => { captureTranscriptDoneRef.current = true; tryProcessSave(); };
      rec.start();
      recognitionRef.current = rec;
    } catch (e) { setManualMode(true); }
  };

  const cancelSave = () => {
    captureCancelledRef.current = true;
    stopSpeechRecognition();
    setTranscript(""); setSavePhase("idle"); setSaveError("");
    setManualMode(false); setManualName(""); setManualNotes(""); setManualPhoto(null);
    setScreen("home");
  };

  const useDemoLocation = () => {
    const d = DEMO_LOCATIONS[Math.floor(Math.random() * DEMO_LOCATIONS.length)];
    captureLocationRef.current = { lat: d.lat, lng: d.lng, accuracy: 0, isDemo: true };
    captureLocationDoneRef.current = true;
    setUserLocation({ lat: d.lat, lng: d.lng });
    setHomeError(""); setPermissionDenied(false); setSavePhase("listening");
    if (captureTranscriptDoneRef.current) tryProcessSave();
  };

  // ============ EDIT / DELETE / SHARE ============
  const openEdit = async (p) => {
    setEditForm({ name: p.name, notes: p.notes || "", categoryOverride: p.categoryOverride || null });
    setEditPhoto(p.photo || null);
    setEditPhotoChanged(false);
    setEditingPlace(p); setSelectedPlace(null);
  };
  const saveEdit = async () => {
    if (!editingPlace || !editForm.name.trim()) return;
    try {
      const updated = await updatePlace(editingPlace.id, {
        name: editForm.name.trim(),
        notes: editForm.notes.trim(),
        categoryOverride: editForm.categoryOverride,
        photo: editPhotoChanged ? editPhoto : undefined
      });
      setPlaces((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      setEditingPlace(null); setSelectedPlace(updated); showToast("Updated");
    } catch (e) {
      showToast("Couldn't save changes");
    }
  };
  const cancelEdit = () => { const c = editingPlace; setEditingPlace(null); if (c) setSelectedPlace(c); };
  const removePlace = async (id) => {
    try {
      await sbDeletePlace(id);
      setPlaces((prev) => prev.filter((p) => p.id !== id));
      setSelectedPlace(null);
    } catch (e) { showToast("Couldn't delete"); }
  };

  const handlePhotoPick = async (e, target) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const d = await compressImage(file);
      if (target === "edit") { setEditPhoto(d); setEditPhotoChanged(true); }
      else if (target === "manual") { setManualPhoto(d); }
    } catch (err) { showToast("Couldn't process photo"); }
    e.target.value = "";
  };

  const buildAppleUrl = (p) => `https://maps.apple.com/?q=${encodeURIComponent(p.name)}&ll=${p.lat},${p.lng}`;
  const buildGoogleUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  const openAppleMaps = (p) => window.open(buildAppleUrl(p), "_blank");
  const openGoogleMaps = (p) => window.open(buildGoogleUrl(p), "_blank");
  const copyText = async (t) => {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      try { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); return true; } catch (e2) { return false; }
    }
  };
  const sharePlace = async (p) => {
    const a = buildAppleUrl(p), g = buildGoogleUrl(p);
    const n = p.notes ? `\n\n${p.notes}` : "";
    const text = `${p.name}${n}\n\n\u{1F4CD} ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}\n\nApple Maps: ${a}\nGoogle Maps: ${g}\n\nSaved with Save This Place`;
    if (navigator.share) {
      try { await navigator.share({ title: p.name, text }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    const ok = await copyText(text);
    showToast(ok ? "Copied. Paste it anywhere." : "Couldn't copy");
  };
  const shareApp = async () => {
    const url = typeof window !== "undefined" ? window.location.origin : "";
    const text = "Save This Place is the easiest way to remember where you've been. Tap once to save the spot you're standing on.";
    if (navigator.share) {
      try { await navigator.share({ title: "Save This Place", text, url }); setShareAppOpen(false); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    const ok = await copyText(`${text}\n${url}`);
    showToast(ok ? "Link copied" : "Couldn't copy link");
    setShareAppOpen(false);
  };
  const shareRoute = async (list, label) => {
    const lines = list.map((p, i) => `${i + 1}. ${p.name}\n   ${buildAppleUrl(p)}`);
    const text = `${label || "A route from Save This Place"}\n\n${lines.join("\n\n")}`;
    if (navigator.share) {
      try { await navigator.share({ title: label || "A route", text }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    const ok = await copyText(text);
    showToast(ok ? "Route copied" : "Couldn't copy");
  };

  // ============ ASK ============
  const startAskListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    try {
      const rec = new SR();
      rec.continuous = false; rec.interimResults = true; rec.lang = "en-US";
      let finalText = "";
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t; else interim += t;
        }
        setAskInput((finalText + interim).trim());
      };
      rec.onerror = () => setAskListening(false);
      rec.onend = () => {
        setAskListening(false);
        setTimeout(() => { const txt = (finalText || "").trim(); if (txt) runAsk(txt); }, 100);
      };
      rec.start();
      askRecognitionRef.current = rec;
      setAskListening(true);
    } catch (e) {}
  };
  const stopAskListening = () => {
    if (askRecognitionRef.current) { try { askRecognitionRef.current.stop(); } catch (e) {} }
    setAskListening(false);
  };
  const getLocationOnce = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });

  const runAsk = async (rawQuery) => {
    const query = (rawQuery ?? askInput).trim();
    if (!query) return;
    stopAskListening();
    setAskLoading(true); setAskError(""); setAskResponse(null);

    let loc = userLocation;
    if (!loc) {
      loc = await getLocationOnce();
      if (loc) { setUserLocation(loc); setAskLocationStatus("granted"); }
      else { setAskLocationStatus("denied"); }
    } else setAskLocationStatus("granted");

    const ctx = places.map((p) => ({
      id: p.id, name: p.name, category: getCategoryKey(p),
      notes: p.notes || "",
      distance_mi: loc ? Number(haversineMiles(loc.lat, loc.lng, p.lat, p.lng).toFixed(2)) : null,
      coords: `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
    }));

    const system = `You are a friendly local guide helping the user navigate their own saved places. Be warm and concise.

Respond with VALID JSON ONLY. No markdown fences. No preamble. Use exactly this shape:
{
  "intro": "1-2 sentence friendly opener",
  "places": [{"id": "<exact id from list>", "reason": "<short reason>"}],
  "is_route": false,
  "outro": "<optional 1 sentence, or empty string>"
}

RULES:
- Only use IDs from the saved places list. Never invent places.
- Default to 3-5 places. For road trips, order by sensible geographic flow and set is_route=true.
- For "near me" questions, prioritize by distance_mi (smallest first).
- If no places match, return places=[] and explain warmly in intro.`;

    const userMsg = `User question: "${query}"
User location: ${loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : "Not available"}

Saved places (${ctx.length} total):
${JSON.stringify(ctx, null, 2)}`;

    try {
      const data = await callAsk({ system, messages: [{ role: "user", content: userMsg }], max_tokens: 1000 });
      const text = (data.content || []).map((c) => (c.type === "text" ? c.text : "")).join("").trim();
      const clean = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(clean);
      parsed.placeObjects = (parsed.places || []).map((e) => {
        const place = places.find((p) => p.id === e.id);
        return place ? { place, reason: e.reason } : null;
      }).filter(Boolean);
      setAskResponse(parsed);
    } catch (e) {
      setAskError("Couldn't reach the guide right now. Try again in a moment.");
    }
    setAskLoading(false);
  };

  const clearAsk = () => { setAskInput(""); setAskResponse(null); setAskError(""); };

  const filteredPlaces = useMemo(() => {
    if (!searchQuery.trim()) return places;
    const q = searchQuery.toLowerCase();
    return places.filter((p) => p.name.toLowerCase().includes(q) || (p.notes || "").toLowerCase().includes(q));
  }, [places, searchQuery]);

  const grouped = useMemo(() => {
    const g = {};
    for (const p of filteredPlaces) { const k = getCategoryKey(p); (g[k] = g[k] || []).push(p); }
    return CATEGORY_ORDER.filter((k) => g[k]).map((k) => [k, g[k]]);
  }, [filteredPlaces]);

  const showTabBar = ["home", "list", "ask"].includes(screen);

  // ============ AUTH SCREEN ============
  if (authLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ ...bg, background: "#F2E8D5" }}>
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}>
          <Compass size={32} color="#E8632D" />
        </motion.div>
      </div>
    );
  }

  if (!currentUser) {
    const isSignUp = authForm.mode === "signup";
    return (
      <div className="min-h-screen w-full flex items-center justify-center p-0 md:p-6" style={{ ...bg, background: "linear-gradient(180deg, #E8DEC8 0%, #D9CCAF 100%)" }}>
        <div className="relative w-full md:max-w-[440px] md:rounded-[40px] md:shadow-2xl overflow-hidden flex flex-col" style={{ height: "100vh", maxHeight: "100vh", background: "#F2E8D5" }}>
          <div className="pointer-events-none absolute inset-0 z-0" style={{ backgroundImage: topoPattern, backgroundSize: "600px 600px", opacity: 0.4 }} />
          <div className="pointer-events-none absolute inset-0 z-0 mix-blend-multiply" style={{ backgroundImage: grainPattern, opacity: 0.15 }} />
          <div className="relative z-10 flex-1 flex flex-col px-7 pt-16 pb-10 overflow-y-auto">
            <div className="flex items-center gap-2.5 mb-10">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "radial-gradient(circle at 35% 25%, #FF9560 0%, #E8632D 60%, #B83E10 100%)", boxShadow: "0 8px 20px -8px rgba(184, 62, 16, 0.55), inset 0 -3px 6px rgba(0,0,0,0.2)" }}>
                <Compass size={22} strokeWidth={2.2} color="#F2E8D5" />
              </div>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#2A2218", letterSpacing: "-0.02em" }}>Save This Place</span>
            </div>
            <p className="text-[11px] uppercase tracking-[0.25em] mb-2" style={{ color: "#7A6B58", fontWeight: 600 }}>{isSignUp ? "Welcome" : "Welcome back"}</p>
            <h1 className="mb-3" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.05, color: "#2A2218" }}>
              {isSignUp ? "Start your field book." : "Sign in to your places."}
            </h1>
            <p className="text-[14px] mb-7 leading-relaxed" style={{ color: "#5C4530" }}>
              {isSignUp
                ? "Save the spots worth coming back to. Each account keeps its own collection."
                : "Pick up where you left off."}
            </p>
            {isSignUp && (
              <input type="text" value={authForm.name} onChange={(e) => setAuthForm((f) => ({ ...f, name: e.target.value, error: "" }))} placeholder="Your name" autoComplete="name" className="w-full rounded-2xl px-4 py-3.5 mb-2.5 outline-none" style={{ background: "#FAF3E3", boxShadow: "inset 0 0 0 1.5px rgba(232, 99, 45, 0.35)", fontSize: 16, color: "#2A2218" }} />
            )}
            <input type="email" value={authForm.email} onChange={(e) => setAuthForm((f) => ({ ...f, email: e.target.value, error: "" }))} placeholder="you@example.com" autoComplete="email" inputMode="email" autoCapitalize="none" className="w-full rounded-2xl px-4 py-3.5 mb-2.5 outline-none" style={{ background: "#FAF3E3", boxShadow: "inset 0 0 0 1.5px rgba(232, 99, 45, 0.35)", fontSize: 16, color: "#2A2218" }} />
            <input type="password" value={authForm.password} onChange={(e) => setAuthForm((f) => ({ ...f, password: e.target.value, error: "" }))} placeholder={isSignUp ? "Pick a password (6+ characters)" : "Password"} autoComplete={isSignUp ? "new-password" : "current-password"} className="w-full rounded-2xl px-4 py-3.5 mb-3 outline-none" style={{ background: "#FAF3E3", boxShadow: "inset 0 0 0 1.5px rgba(232, 99, 45, 0.35)", fontSize: 16, color: "#2A2218" }} />
            {authForm.error && (<p className="text-[13px] mb-3 px-1 font-medium" style={{ color: "#B83E10" }}>{authForm.error}</p>)}
            <motion.button onClick={isSignUp ? doSignUp : doSignIn} disabled={authForm.busy} whileTap={{ scale: 0.98 }} className="relative w-full py-4 rounded-2xl text-[16px] font-bold overflow-hidden mb-3" style={{ background: "radial-gradient(circle at 30% 20%, #FF9560 0%, #E8632D 60%, #B83E10 100%)", color: "white", boxShadow: "0 12px 28px -10px rgba(184, 62, 16, 0.55), inset 0 -4px 12px rgba(0,0,0,0.15), inset 0 2px 6px rgba(255,255,255,0.3)", opacity: authForm.busy ? 0.7 : 1 }}>
              <div className="absolute inset-0 pointer-events-none mix-blend-overlay" style={{ backgroundImage: grainPattern, opacity: 0.3 }} />
              <span className="relative">{authForm.busy ? "One moment…" : (isSignUp ? "Get Started" : "Sign In")}</span>
            </motion.button>
            <button onClick={() => setAuthForm((f) => ({ ...f, mode: isSignUp ? "signin" : "signup", error: "" }))} className="w-full py-2 text-[13px] font-semibold" style={{ color: "#5C4530" }}>
              {isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============ MAIN APP ============
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-0 md:p-6" style={{ ...bg, background: "linear-gradient(180deg, #E8DEC8 0%, #D9CCAF 100%)" }}>
      <div className="relative w-full md:max-w-[440px] md:rounded-[40px] md:shadow-2xl overflow-hidden flex flex-col" style={{ height: "100vh", maxHeight: "100vh", background: "#F2E8D5", color: "#2A2218" }}>
        <div className="pointer-events-none absolute inset-0 z-0" style={{ backgroundImage: topoPattern, backgroundSize: "600px 600px", opacity: 0.4 }} />
        <div className="pointer-events-none absolute inset-0 z-0 mix-blend-multiply" style={{ backgroundImage: grainPattern, opacity: 0.15 }} />
        <div className="pointer-events-none absolute inset-0 z-0" style={{ background: "radial-gradient(ellipse at 50% 100%, transparent 40%, rgba(92, 69, 48, 0.12) 100%)" }} />

        <input ref={editFileInputRef} type="file" accept="image/*" capture="environment" onChange={(e) => handlePhotoPick(e, "edit")} style={{ display: "none" }} />
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={(e) => handlePhotoPick(e, "manual")} style={{ display: "none" }} />

        <div className="relative flex items-center justify-between px-5 pt-6 pb-2 z-10">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#E8632D", boxShadow: "inset 0 -2px 4px rgba(0,0,0,0.15)" }}>
              <Compass size={15} strokeWidth={2.4} color="#F2E8D5" />
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#2A2218", letterSpacing: "-0.02em" }}>Save This Place</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShareAppOpen(true)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(92, 69, 48, 0.08)", color: "#5C4530" }} aria-label="Share app">
              <Share2 size={14} strokeWidth={2.4} />
            </button>
            <button onClick={() => setShowProfile(true)} className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: "radial-gradient(circle at 35% 25%, #FF9560, #E8632D)", color: "white", boxShadow: "0 2px 6px -2px rgba(184, 62, 16, 0.5), inset 0 -1px 2px rgba(0,0,0,0.15)" }} aria-label="Profile">
              {initialsOf(currentUser.name)}
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {screen === "home" && (
            <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="relative flex-1 flex flex-col px-6 pb-4 z-10 min-h-0">
              <div className="pt-3">
                <p className="text-[11px] uppercase tracking-[0.25em] mb-2" style={{ color: "#7A6B58", fontWeight: 600 }}>Tap and talk</p>
                <h1 style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.05, color: "#2A2218" }}>Hi {currentUser.name.split(" ")[0]}. Where are we now?</h1>
              </div>
              <div className="flex-1 flex items-center justify-center py-2 min-h-0">
                <div className="relative">
                  <motion.div className="absolute inset-0 rounded-full" style={{ background: "#E8632D", filter: "blur(55px)", opacity: 0.4 }} animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }} />
                  <div className="absolute rounded-full border-2 border-dashed" style={{ inset: -18, borderColor: "rgba(92, 69, 48, 0.22)", animation: "spin 40s linear infinite" }} />
                  <motion.button onClick={handleSavePress} whileTap={{ scale: 0.94 }} className="relative rounded-full flex flex-col items-center justify-center text-white" style={{ width: 200, height: 200, background: "radial-gradient(circle at 35% 25%, #FF9560 0%, #E8632D 50%, #B83E10 100%)", boxShadow: "0 28px 50px -16px rgba(184, 62, 16, 0.6), inset 0 -14px 28px rgba(0,0,0,0.25), inset 0 6px 16px rgba(255,255,255,0.35), 0 0 0 1px rgba(184, 62, 16, 0.4)" }}>
                    <div className="absolute inset-0 rounded-full pointer-events-none mix-blend-overlay" style={{ backgroundImage: grainPattern, opacity: 0.35 }} />
                    <MapPin size={38} strokeWidth={2} fill="white" className="mb-1" />
                    <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>Save This</span>
                    <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em", marginTop: -3 }}>Place</span>
                  </motion.button>
                </div>
              </div>
              <p className="text-center text-[12px] mb-2" style={{ color: "#7A6B58" }}>Tap, then just talk. I'll name it for you.</p>
              {homeError && (
                <div className="rounded-2xl px-4 py-3 text-[13px] text-center font-medium" style={{ background: "#F4DDCB", color: "#B83E10", border: "1px solid rgba(184, 62, 16, 0.2)" }}>{homeError}</div>
              )}
            </motion.div>
          )}

          {screen === "capturing" && (
            <motion.div key="capturing" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }} className="relative flex-1 flex flex-col px-6 pb-6 pt-2 z-10 min-h-0 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <button onClick={cancelSave} className="text-[13px] font-bold uppercase tracking-wider" style={{ color: "#B83E10" }}>Cancel</button>
                <div className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: captureLocationDoneRef.current && !captureLocationRef.current?.error ? "#3F5C2E" : "#7A6B58" }}>
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: captureLocationDoneRef.current && !captureLocationRef.current?.error ? "#3F5C2E" : "#B5832A" }} />
                  {captureLocationDoneRef.current ? (captureLocationRef.current?.error ? "Location error" : (captureLocationRef.current?.isDemo ? "Demo location" : "Pinned")) : "Pinning…"}
                </div>
              </div>

              {savePhase === "listening" && !manualMode && (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <div className="relative mb-6">
                    <motion.div className="absolute inset-0 rounded-full" style={{ background: "#E8632D", filter: "blur(35px)", opacity: 0.5 }} animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }} />
                    <motion.div className="absolute rounded-full" style={{ inset: -12, border: "2px solid rgba(232, 99, 45, 0.4)" }} animate={{ scale: [1, 1.18], opacity: [0.6, 0] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }} />
                    <div className="relative rounded-full flex items-center justify-center" style={{ width: 130, height: 130, background: "radial-gradient(circle at 35% 25%, #FF9560 0%, #E8632D 55%, #B83E10 100%)", boxShadow: "0 16px 36px -12px rgba(184, 62, 16, 0.55), inset 0 -10px 20px rgba(0,0,0,0.22), inset 0 4px 12px rgba(255,255,255,0.3)" }}>
                      <div className="absolute inset-0 rounded-full pointer-events-none mix-blend-overlay" style={{ backgroundImage: grainPattern, opacity: 0.35 }} />
                      <motion.div animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 0.8, repeat: Infinity }}>
                        <Mic size={50} strokeWidth={2} fill="white" color="white" />
                      </motion.div>
                    </div>
                  </div>
                  <h2 style={{ fontSize: 24, fontWeight: 700, color: "#2A2218" }} className="mb-1">I'm listening…</h2>
                  <p className="text-[13px]" style={{ color: "#7A6B58" }}>Describe the place. I'll name it for you.</p>
                  {transcript && (
                    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-6 px-5 py-3 rounded-2xl max-w-full" style={{ background: "#FAF3E3", boxShadow: "inset 0 0 0 1px rgba(92, 69, 48, 0.12)" }}>
                      <p className="text-[15px] leading-relaxed text-left" style={{ color: "#2A2218" }}>"{transcript}"</p>
                    </motion.div>
                  )}
                  <button onClick={stopSpeechRecognition} className="mt-6 px-5 py-2.5 rounded-full text-[12px] font-bold uppercase tracking-wider" style={{ background: "rgba(92, 69, 48, 0.1)", color: "#5C4530" }}>Done Speaking</button>
                  <button onClick={() => { stopSpeechRecognition(); setManualMode(true); setManualName(transcript); }} className="mt-3 text-[12px] underline font-semibold" style={{ color: "#7A6B58" }}>Type instead</button>
                </div>
              )}

              {savePhase === "processing" && (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="mb-5">
                    <Sparkles size={42} strokeWidth={2} color="#E8632D" />
                  </motion.div>
                  <h2 style={{ fontSize: 22, fontWeight: 700, color: "#2A2218" }} className="mb-1">Saving…</h2>
                  <p className="text-[13px]" style={{ color: "#7A6B58" }}>Picking a good name for it</p>
                  {transcript && (<p className="mt-5 px-4 py-2 rounded-xl text-[13px] italic" style={{ background: "rgba(92, 69, 48, 0.08)", color: "#5C4530" }}>"{transcript}"</p>)}
                </div>
              )}

              {savePhase === "failed" && (
                <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ background: "#F4DDCB" }}>
                    <X size={28} strokeWidth={2.4} color="#B83E10" />
                  </div>
                  <p style={{ fontSize: 18, fontWeight: 700, color: "#2A2218" }} className="mb-1">Couldn't save</p>
                  <p className="text-[13px] mb-5" style={{ color: "#7A6B58" }}>{saveError}</p>
                  {permissionDenied && (
                    <button onClick={useDemoLocation} className="mb-3 px-5 py-3 rounded-2xl text-[12px] font-bold uppercase tracking-wider" style={{ background: "rgba(184, 62, 16, 0.12)", color: "#B83E10" }}>Use a demo location</button>
                  )}
                  <button onClick={cancelSave} className="px-5 py-2.5 rounded-full text-[12px] font-bold uppercase tracking-wider" style={{ background: "rgba(92, 69, 48, 0.1)", color: "#5C4530" }}>Back</button>
                </div>
              )}

              {manualMode && savePhase === "listening" && (
                <div className="flex-1 flex flex-col">
                  <div className="mb-3">
                    <h2 style={{ fontSize: 22, fontWeight: 700, color: "#2A2218" }}>Type the name</h2>
                    {saveError && <p className="text-[12px] mt-1" style={{ color: "#B83E10" }}>{saveError}</p>}
                  </div>
                  <input type="text" autoFocus value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Place name" className="w-full rounded-2xl px-4 py-3 mb-2.5 outline-none" style={{ background: "#FAF3E3", boxShadow: "inset 0 0 0 1.5px rgba(232, 99, 45, 0.35)", fontSize: 17, fontWeight: 500, color: "#2A2218" }} />
                  <input type="text" value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} placeholder="Notes (optional)" className="w-full rounded-2xl px-4 py-3 mb-2.5 outline-none" style={{ background: "#FAF3E3", boxShadow: "inset 0 0 0 1px rgba(92, 69, 48, 0.15)", fontSize: 14, color: "#2A2218" }} />
                  {manualPhoto ? (
                    <div className="relative rounded-2xl overflow-hidden mb-2.5" style={{ boxShadow: "0 4px 16px -8px rgba(92, 69, 48, 0.3)" }}>
                      <img src={manualPhoto} alt="" className="w-full h-44 object-cover" />
                      <button onClick={() => setManualPhoto(null)} className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", color: "white" }}><X size={14} strokeWidth={2.4} /></button>
                    </div>
                  ) : (
                    <button onClick={() => fileInputRef.current?.click()} className="w-full rounded-2xl py-3 mb-2.5 flex items-center justify-center gap-2 text-[13px] font-bold uppercase tracking-wider" style={{ background: "#FAF3E3", color: "#5C4530", boxShadow: "inset 0 0 0 1px rgba(92, 69, 48, 0.15)" }}>
                      <Camera size={14} strokeWidth={2.4} />Add a Photo
                    </button>
                  )}
                  <button onClick={retryListening} className="w-full py-3 rounded-2xl mb-2.5 flex items-center justify-center gap-2 text-[13px] font-bold uppercase tracking-wider" style={{ background: "rgba(232, 99, 45, 0.1)", color: "#C44818" }}>
                    <RefreshCw size={13} strokeWidth={2.4} />Try Voice Again
                  </button>
                  <motion.button onClick={manualSubmitSave} disabled={!manualName.trim()} whileTap={{ scale: 0.98 }} className="relative w-full py-4 rounded-2xl text-[17px] font-bold overflow-hidden mt-auto" style={{ background: manualName.trim() ? "radial-gradient(circle at 30% 20%, #FF9560 0%, #E8632D 60%, #B83E10 100%)" : "rgba(92, 69, 48, 0.15)", color: manualName.trim() ? "white" : "rgba(92, 69, 48, 0.4)", boxShadow: manualName.trim() ? "0 12px 28px -10px rgba(184, 62, 16, 0.55), inset 0 -4px 12px rgba(0,0,0,0.15), inset 0 2px 6px rgba(255,255,255,0.3)" : "none" }}>
                    {manualName.trim() && <div className="absolute inset-0 pointer-events-none mix-blend-overlay" style={{ backgroundImage: grainPattern, opacity: 0.3 }} />}
                    <span className="relative">Save Place</span>
                  </motion.button>
                </div>
              )}
            </motion.div>
          )}

          {screen === "saved" && (
            <motion.div key="saved" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative flex-1 flex flex-col items-center justify-center z-10 px-6">
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 220, damping: 14 }} className="relative rounded-full flex items-center justify-center mb-5" style={{ width: 110, height: 110, background: "radial-gradient(circle at 30% 25%, #5F8A48, #3F5C2E)", boxShadow: "0 18px 40px -14px rgba(63, 92, 46, 0.6), inset 0 -6px 16px rgba(0,0,0,0.2)" }}>
                <div className="absolute inset-0 rounded-full pointer-events-none mix-blend-overlay" style={{ backgroundImage: grainPattern, opacity: 0.3 }} />
                <Check size={50} strokeWidth={2.8} color="white" className="relative" />
              </motion.div>
              <p className="text-[12px] uppercase tracking-wider font-bold mb-1" style={{ color: "#7A6B58" }}>Saved</p>
              <p className="text-center" style={{ fontSize: 22, fontWeight: 700, color: "#2A2218", lineHeight: 1.2 }}>{generatedTitle || manualName || "Pinned to your map"}</p>
            </motion.div>
          )}

          {screen === "ask" && (
            <motion.div key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="relative flex-1 flex flex-col z-10 min-h-0 overflow-hidden">
              <div className="px-6 pt-3 pb-2">
                <p className="text-[11px] uppercase tracking-[0.25em] mb-1" style={{ color: "#7A6B58", fontWeight: 600 }}>Ask</p>
                <h1 style={{ fontSize: 26, fontWeight: 700, color: "#2A2218" }}>What can I help you find?</h1>
              </div>
              <div className="flex-1 overflow-y-auto px-6 pb-3">
                {places.length === 0 ? (
                  <div className="text-center py-16" style={{ color: "#7A6B58" }}>
                    <Sparkles size={36} strokeWidth={1.6} className="mx-auto mb-3 opacity-60" color="#E8632D" />
                    <p className="text-[15px] font-medium mb-1" style={{ color: "#2A2218" }}>Save some places first</p>
                    <p className="text-[13px]">Then I can help you find them by mood, distance, or vibe.</p>
                  </div>
                ) : (<>
                  {!askResponse && !askLoading && (<>
                    <div className="flex items-center justify-center py-2 mb-3">
                      <div className="relative">
                        <motion.div className="absolute inset-0 rounded-full" style={{ background: "#E8632D", filter: "blur(40px)", opacity: askListening ? 0.5 : 0.3 }} animate={{ scale: askListening ? [1, 1.2, 1] : [1, 1.05, 1] }} transition={{ duration: askListening ? 1.4 : 3, repeat: Infinity }} />
                        <motion.button onClick={askListening ? stopAskListening : startAskListening} whileTap={{ scale: 0.94 }} className="relative rounded-full flex flex-col items-center justify-center text-white" style={{ width: 132, height: 132, background: "radial-gradient(circle at 35% 25%, #FF9560 0%, #E8632D 50%, #B83E10 100%)", boxShadow: "0 18px 40px -14px rgba(184, 62, 16, 0.55), inset 0 -10px 20px rgba(0,0,0,0.22), inset 0 4px 12px rgba(255,255,255,0.3), 0 0 0 1px rgba(184, 62, 16, 0.4)" }}>
                          <div className="absolute inset-0 rounded-full pointer-events-none mix-blend-overlay" style={{ backgroundImage: grainPattern, opacity: 0.35 }} />
                          {askListening ? (
                            <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 0.9, repeat: Infinity }}>
                              <Mic size={32} strokeWidth={2.2} fill="white" />
                            </motion.div>
                          ) : (<><Mic size={28} strokeWidth={2.2} fill="white" className="mb-0.5" /><span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>Ask</span></>)}
                        </motion.button>
                      </div>
                    </div>
                    <p className="text-center text-[12px] mb-4" style={{ color: "#7A6B58" }}>{askListening ? (askInput || "Listening… just talk") : "Tap to ask out loud"}</p>
                    <div className="flex flex-wrap gap-2 mb-4 justify-center">
                      {SUGGESTED_PROMPTS.map((p) => (
                        <button key={p} onClick={() => { setAskInput(p); runAsk(p); }} className="px-3 py-2 rounded-full text-[12px] font-semibold" style={{ background: "rgba(232, 99, 45, 0.1)", color: "#C44818", border: "1px solid rgba(232, 99, 45, 0.25)" }}>{p}</button>
                      ))}
                    </div>
                  </>)}
                  {askLoading && (
                    <div className="py-12 flex flex-col items-center justify-center" style={{ color: "#5C4530" }}>
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }} className="mb-3"><Sparkles size={28} strokeWidth={2} color="#E8632D" /></motion.div>
                      <p className="text-[13px] font-medium">checking your field book…</p>
                    </div>
                  )}
                  {askError && !askLoading && (<div className="rounded-2xl px-4 py-3 text-[13px] text-center" style={{ background: "#F4DDCB", color: "#B83E10" }}>{askError}</div>)}
                  {askResponse && !askLoading && (
                    <div>
                      {askResponse.intro && (<p className="text-[15px] leading-relaxed mb-4" style={{ color: "#2A2218" }}>{askResponse.intro}</p>)}
                      {askLocationStatus === "denied" && (<div className="rounded-xl px-3 py-2 mb-3 text-[12px] font-medium" style={{ background: "rgba(232, 99, 45, 0.08)", color: "#7A6B58" }}>Tip: turn on location to get distance-based answers.</div>)}
                      {askResponse.placeObjects && askResponse.placeObjects.length > 0 && (
                        <div className="space-y-2 mb-4">
                          {askResponse.placeObjects.map(({ place, reason }, idx) => {
                            const cat = CATEGORIES[getCategoryKey(place)];
                            const dist = userLocation ? formatDistance(haversineMiles(userLocation.lat, userLocation.lng, place.lat, place.lng)) : null;
                            return (
                              <motion.button key={place.id} onClick={() => setSelectedPlace(place)} whileTap={{ scale: 0.99 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }} className="relative w-full text-left rounded-2xl p-3 flex items-start gap-3" style={{ background: "#FAF3E3", boxShadow: "0 2px 10px -6px rgba(92, 69, 48, 0.25), inset 0 0 0 1px rgba(92, 69, 48, 0.06)" }}>
                                {askResponse.is_route && (<div className="absolute -top-1 -left-1 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ background: "#E8632D", color: "white", boxShadow: "0 2px 6px rgba(184, 62, 16, 0.4)" }}>{idx + 1}</div>)}
                                {place.photo ? (
                                  <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0" style={{ boxShadow: `inset 0 0 0 1.5px ${cat.color}` }}><img src={place.photo} alt="" className="w-full h-full object-cover" /></div>
                                ) : (
                                  <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-[20px]" style={{ background: cat.soft, boxShadow: `inset 0 0 0 1.5px ${cat.color}` }}>{cat.emoji}</div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-[15px] font-semibold truncate" style={{ color: "#2A2218" }}>{place.name}</p>
                                  <p className="text-[12px] mt-0.5" style={{ color: "#5C4530", lineHeight: 1.35 }}>{reason}</p>
                                  {dist && (<p className="text-[10px] mt-1 font-mono uppercase tracking-wider font-bold" style={{ color: cat.color }}>{dist} away</p>)}
                                </div>
                              </motion.button>
                            );
                          })}
                        </div>
                      )}
                      {askResponse.outro && (<p className="text-[13px] mb-4 italic" style={{ color: "#5C4530" }}>{askResponse.outro}</p>)}
                      {askResponse.is_route && askResponse.placeObjects?.length > 1 && (
                        <button onClick={() => shareRoute(askResponse.placeObjects.map((x) => x.place), `My route: ${askInput}`)} className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 text-[13px] font-bold uppercase tracking-wider mb-2" style={{ background: "radial-gradient(circle at 30% 20%, #FF9560 0%, #E8632D 60%, #B83E10 100%)", color: "white", boxShadow: "0 10px 24px -10px rgba(184, 62, 16, 0.5)" }}>
                          <Send size={13} strokeWidth={2.4} />Send Whole Route
                        </button>
                      )}
                      <button onClick={clearAsk} className="w-full py-2.5 rounded-2xl text-[12px] font-bold uppercase tracking-wider" style={{ background: "rgba(92, 69, 48, 0.08)", color: "#5C4530" }}>Ask Something Else</button>
                    </div>
                  )}
                </>)}
              </div>
              {places.length > 0 && !askResponse && (
                <div className="px-5 pb-3 pt-1">
                  <div className="relative rounded-full flex items-center gap-2 pl-4 pr-2 py-2" style={{ background: "#FAF3E3", boxShadow: "inset 0 0 0 1.5px rgba(232, 99, 45, 0.35), 0 4px 16px -8px rgba(92, 69, 48, 0.2)" }}>
                    <input type="text" value={askInput} onChange={(e) => setAskInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runAsk(); }} placeholder="Or type a question…" disabled={askLoading} className="flex-1 bg-transparent outline-none text-[14px]" style={{ color: "#2A2218" }} />
                    <button onClick={() => runAsk()} disabled={!askInput.trim() || askLoading} className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity" style={{ background: askInput.trim() ? "#E8632D" : "rgba(92, 69, 48, 0.15)", color: "white", opacity: askInput.trim() ? 1 : 0.4 }}>
                      <ArrowUp size={15} strokeWidth={2.6} />
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {screen === "list" && (
            <motion.div key="list" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }} className="relative flex-1 flex flex-col z-10 overflow-hidden min-h-0">
              <div className="px-6 pt-3 pb-2">
                <p className="text-[11px] uppercase tracking-[0.25em] mb-1" style={{ color: "#7A6B58", fontWeight: 600 }}>Field Book</p>
                <h1 style={{ fontSize: 26, fontWeight: 700, color: "#2A2218" }}>Your Places</h1>
              </div>
              {places.length > 0 && (
                <div className="px-6 pb-3">
                  <div className="relative rounded-2xl flex items-center" style={{ background: "#FAF3E3", boxShadow: "inset 0 0 0 1px rgba(92, 69, 48, 0.15)" }}>
                    <Search size={15} strokeWidth={2.4} className="ml-3.5 flex-shrink-0" color="#7A6B58" />
                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search your places" className="flex-1 bg-transparent outline-none px-2.5 py-2.5 text-[14px]" style={{ color: "#2A2218" }} />
                    {searchQuery && (<button onClick={() => setSearchQuery("")} className="mr-2 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(92, 69, 48, 0.15)" }}><X size={11} strokeWidth={2.6} color="#5C4530" /></button>)}
                  </div>
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-6 pb-4">
                {placesLoading ? (
                  <div className="text-center py-16" style={{ color: "#7A6B58" }}>Loading…</div>
                ) : places.length === 0 ? (
                  <div className="text-center py-16" style={{ color: "#7A6B58" }}>
                    <Mountain size={42} strokeWidth={1.6} className="mx-auto mb-3 opacity-50" />
                    <p className="text-[15px] font-medium">No entries yet</p>
                  </div>
                ) : grouped.length === 0 ? (
                  <div className="text-center py-12" style={{ color: "#7A6B58" }}>
                    <Search size={32} strokeWidth={1.6} className="mx-auto mb-3 opacity-50" />
                    <p className="text-[14px]">Nothing matches "{searchQuery}"</p>
                  </div>
                ) : (
                  grouped.map(([catKey, list]) => {
                    const cat = CATEGORIES[catKey];
                    return (
                      <div key={catKey} className="mb-5">
                        <div className="flex items-center gap-2 mb-2 px-1">
                          <span className="px-2.5 py-1 rounded-full text-[10px] font-bold flex items-center gap-1.5 uppercase tracking-wider" style={{ background: cat.soft, color: cat.color }}>
                            <span>{cat.emoji}</span>{cat.label}
                          </span>
                          <span className="text-[11px] font-semibold" style={{ color: "#7A6B58" }}>{list.length}</span>
                        </div>
                        <div className="space-y-2">
                          {list.map((place) => (
                            <div key={place.id} className="rounded-2xl flex items-center gap-1 relative overflow-hidden" style={{ background: "#FAF3E3", boxShadow: "0 2px 10px -6px rgba(92, 69, 48, 0.25), inset 0 0 0 1px rgba(92, 69, 48, 0.06)" }}>
                              <motion.button onClick={() => setSelectedPlace(place)} whileTap={{ scale: 0.99 }} className="flex-1 text-left p-2.5 flex items-center gap-3 min-w-0">
                                {place.photo ? (
                                  <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0" style={{ boxShadow: `inset 0 0 0 1.5px ${cat.color}` }}><img src={place.photo} alt="" className="w-full h-full object-cover" /></div>
                                ) : (
                                  <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-[20px]" style={{ background: cat.soft, boxShadow: `inset 0 0 0 1.5px ${cat.color}` }}>{cat.emoji}</div>
                                )}
                                <div className="flex-1 min-w-0 py-0.5">
                                  <p className="text-[15px] font-semibold truncate" style={{ color: "#2A2218" }}>{place.name}</p>
                                  {place.notes && (<p className="text-[12px] truncate mt-0.5" style={{ color: "#5C4530" }}>{place.notes}</p>)}
                                  <p className="text-[10px] mt-0.5 font-mono" style={{ color: "#7A6B58" }}>{timeAgo(place.createdAt)} · {place.lat.toFixed(3)}, {place.lng.toFixed(3)}</p>
                                </div>
                              </motion.button>
                              <motion.button onClick={(e) => { e.stopPropagation(); sharePlace(place); }} whileTap={{ scale: 0.9 }} className="w-10 h-10 mr-2 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(232, 99, 45, 0.12)", color: "#C44818" }} aria-label="Share place">
                                <Send size={14} strokeWidth={2.4} />
                              </motion.button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {showTabBar && (
          <div className="relative z-10 flex items-stretch border-t" style={{ borderColor: "rgba(92, 69, 48, 0.15)", background: "rgba(242, 232, 213, 0.92)", backdropFilter: "blur(20px)" }}>
            {[
              { id: "home", label: "Save", icon: MapPin },
              { id: "ask", label: "Ask", icon: Sparkles },
              { id: "list", label: "Field Book", icon: BookOpen }
            ].map((tab) => {
              const active = screen === tab.id;
              const Icon = tab.icon;
              return (
                <motion.button key={tab.id} onClick={() => setScreen(tab.id)} whileTap={{ scale: 0.92 }} className="flex-1 flex flex-col items-center justify-center gap-1 py-3 pb-4" style={{ color: active ? "#E8632D" : "rgba(92, 69, 48, 0.55)" }}>
                  <Icon size={20} strokeWidth={active ? 2.4 : 2} fill={active && tab.id === "home" ? "#E8632D" : "none"} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">{tab.label}</span>
                </motion.button>
              );
            })}
          </div>
        )}

        {/* Profile sheet */}
        <AnimatePresence>
          {showProfile && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowProfile(false)} className="absolute inset-0 z-40" style={{ background: "rgba(42, 34, 24, 0.5)" }} />
              <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 32 }} className="absolute bottom-0 left-0 right-0 z-50 rounded-t-[28px] overflow-hidden flex flex-col" style={{ background: "#F2E8D5", boxShadow: "0 -12px 40px -10px rgba(42, 34, 24, 0.3)" }}>
                <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: topoPattern, backgroundSize: "600px 600px", opacity: 0.35 }} />
                <div className="absolute inset-0 pointer-events-none mix-blend-multiply" style={{ backgroundImage: grainPattern, opacity: 0.12 }} />
                <div className="relative p-6 pb-8">
                  <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "rgba(92, 69, 48, 0.25)" }} />
                  <div className="flex items-center gap-4 mb-5">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center text-[20px] font-bold flex-shrink-0" style={{ background: "radial-gradient(circle at 35% 25%, #FF9560, #E8632D)", color: "white", boxShadow: "0 6px 16px -6px rgba(184, 62, 16, 0.5), inset 0 -2px 4px rgba(0,0,0,0.18)" }}>
                      {initialsOf(currentUser.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 18, fontWeight: 700, color: "#2A2218", lineHeight: 1.2 }} className="truncate">{currentUser.name}</p>
                      <p className="text-[13px] truncate" style={{ color: "#5C4530" }}>{currentUser.email}</p>
                    </div>
                  </div>
                  <div className="rounded-2xl p-3.5 mb-4 flex items-center gap-3" style={{ background: "rgba(92, 69, 48, 0.06)" }}>
                    <BookOpen size={18} strokeWidth={2.2} color="#5C4530" className="flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-[14px] font-semibold" style={{ color: "#2A2218" }}>{places.length} {places.length === 1 ? "place" : "places"} saved</p>
                      <p className="text-[11px]" style={{ color: "#7A6B58" }}>Member since {new Date(currentUser.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</p>
                    </div>
                  </div>
                  <button onClick={doSignOut} className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 text-[14px] font-bold mb-2.5" style={{ background: "rgba(184, 62, 16, 0.1)", color: "#B83E10" }}>
                    <LogOut size={15} strokeWidth={2.4} />Sign Out
                  </button>
                  <p className="text-[11px] text-center leading-relaxed px-2" style={{ color: "#7A6B58" }}>
                    Your places sync across every device you sign in on.
                  </p>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Detail sheet */}
        <AnimatePresence>
          {selectedPlace && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedPlace(null)} className="absolute inset-0 z-20" style={{ background: "rgba(42, 34, 24, 0.45)" }} />
              <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 32 }} className="absolute bottom-0 left-0 right-0 z-30 rounded-t-[28px] overflow-hidden max-h-[90%] flex flex-col" style={{ background: "#F2E8D5", boxShadow: "0 -12px 40px -10px rgba(42, 34, 24, 0.3)" }}>
                <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: topoPattern, backgroundSize: "600px 600px", opacity: 0.35 }} />
                <div className="absolute inset-0 pointer-events-none mix-blend-multiply" style={{ backgroundImage: grainPattern, opacity: 0.12 }} />
                <div className="relative overflow-y-auto p-6 pb-8">
                  <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "rgba(92, 69, 48, 0.25)" }} />
                  {selectedPlace.photo && (
                    <div className="rounded-2xl overflow-hidden mb-4" style={{ boxShadow: "0 8px 20px -8px rgba(92, 69, 48, 0.35)" }}>
                      <img src={selectedPlace.photo} alt={selectedPlace.name} className="w-full h-52 object-cover" />
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <h3 style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, color: "#2A2218" }}>{selectedPlace.name}</h3>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => openEdit(selectedPlace)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(92, 69, 48, 0.1)" }}><Pencil size={14} strokeWidth={2.4} color="#5C4530" /></button>
                      <button onClick={() => setSelectedPlace(null)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(92, 69, 48, 0.1)" }}><X size={15} strokeWidth={2.4} color="#5C4530" /></button>
                    </div>
                  </div>
                  {selectedPlace.notes && (<p className="text-[14px] mb-4 leading-relaxed" style={{ color: "#3D332A" }}>{selectedPlace.notes}</p>)}
                  <div className="flex items-center gap-2 mb-4 flex-wrap">
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ background: CATEGORIES[getCategoryKey(selectedPlace)].soft, color: CATEGORIES[getCategoryKey(selectedPlace)].color }}>
                      <span>{CATEGORIES[getCategoryKey(selectedPlace)].emoji}</span>{CATEGORIES[getCategoryKey(selectedPlace)].label}
                    </span>
                    {userLocation && (<span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "#7A6B58" }}>{formatDistance(haversineMiles(userLocation.lat, userLocation.lng, selectedPlace.lat, selectedPlace.lng))} away</span>)}
                    <span className="text-[11px]" style={{ color: "#7A6B58" }}>{timeAgo(selectedPlace.createdAt)}</span>
                  </div>
                  <div className="rounded-2xl p-3.5 mb-4 font-mono text-[12px]" style={{ background: "rgba(92, 69, 48, 0.08)", color: "#5C4530", border: "1px dashed rgba(92, 69, 48, 0.25)" }}>
                    <div className="text-[9px] uppercase tracking-wider mb-1 opacity-60 font-sans">Coordinates</div>
                    {selectedPlace.lat.toFixed(6)}, {selectedPlace.lng.toFixed(6)}
                  </div>
                  <motion.button onClick={() => sharePlace(selectedPlace)} whileTap={{ scale: 0.98 }} className="relative w-full py-4 rounded-2xl flex items-center justify-center gap-2 text-[16px] font-bold overflow-hidden mb-2.5" style={{ background: "radial-gradient(circle at 30% 20%, #FF9560 0%, #E8632D 60%, #B83E10 100%)", color: "white", boxShadow: "0 12px 28px -10px rgba(184, 62, 16, 0.55), inset 0 -3px 8px rgba(0,0,0,0.15)" }}>
                    <div className="absolute inset-0 pointer-events-none mix-blend-overlay" style={{ backgroundImage: grainPattern, opacity: 0.3 }} />
                    <Share2 size={17} strokeWidth={2.4} className="relative" /><span className="relative">Send to a Friend</span>
                  </motion.button>
                  <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                    <motion.button onClick={() => openAppleMaps(selectedPlace)} whileTap={{ scale: 0.97 }} className="py-3.5 rounded-2xl flex items-center justify-center gap-1.5 text-[13px] font-bold" style={{ background: "#2A2218", color: "#F2E8D5" }}>
                      <Navigation size={14} strokeWidth={2.4} />Apple Maps
                    </motion.button>
                    <motion.button onClick={() => openGoogleMaps(selectedPlace)} whileTap={{ scale: 0.97 }} className="py-3.5 rounded-2xl flex items-center justify-center gap-1.5 text-[13px] font-bold" style={{ background: "#FAF3E3", color: "#2A2218", boxShadow: "inset 0 0 0 1.5px rgba(92, 69, 48, 0.2)" }}>
                      <Map size={14} strokeWidth={2.4} />Google Maps
                    </motion.button>
                  </div>
                  <button onClick={() => removePlace(selectedPlace.id)} className="w-full py-2.5 rounded-2xl flex items-center justify-center gap-2 text-[12px] font-bold uppercase tracking-wider" style={{ color: "#B83E10", background: "rgba(184, 62, 16, 0.08)" }}>
                    <Trash2 size={12} strokeWidth={2.4} />Remove Entry
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Edit sheet */}
        <AnimatePresence>
          {editingPlace && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={cancelEdit} className="absolute inset-0 z-40" style={{ background: "rgba(42, 34, 24, 0.5)" }} />
              <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 32 }} className="absolute bottom-0 left-0 right-0 z-50 rounded-t-[28px] overflow-hidden max-h-[92%] flex flex-col" style={{ background: "#F2E8D5", boxShadow: "0 -12px 40px -10px rgba(42, 34, 24, 0.3)" }}>
                <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: topoPattern, backgroundSize: "600px 600px", opacity: 0.35 }} />
                <div className="absolute inset-0 pointer-events-none mix-blend-multiply" style={{ backgroundImage: grainPattern, opacity: 0.12 }} />
                <div className="relative overflow-y-auto p-6 pb-8">
                  <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "rgba(92, 69, 48, 0.25)" }} />
                  <div className="flex items-center justify-between mb-4">
                    <button onClick={cancelEdit} className="text-[13px] font-bold uppercase tracking-wider" style={{ color: "#B83E10" }}>Cancel</button>
                    <p className="text-[13px] font-bold uppercase tracking-wider" style={{ color: "#5C4530" }}>Edit Entry</p>
                    <button onClick={saveEdit} disabled={!editForm.name.trim()} className="text-[13px] font-bold uppercase tracking-wider transition-opacity" style={{ color: "#3F5C2E", opacity: editForm.name.trim() ? 1 : 0.4 }}>Save</button>
                  </div>
                  {editPhoto && (
                    <div className="relative rounded-2xl overflow-hidden mb-3" style={{ boxShadow: "0 4px 16px -8px rgba(92, 69, 48, 0.3)" }}>
                      <img src={editPhoto} alt="" className="w-full h-44 object-cover" />
                      <div className="absolute top-2 right-2 flex gap-1.5">
                        <button onClick={() => editFileInputRef.current?.click()} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", color: "white" }}><Camera size={14} strokeWidth={2.4} /></button>
                        <button onClick={() => { setEditPhoto(null); setEditPhotoChanged(true); }} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", color: "white" }}><X size={14} strokeWidth={2.4} /></button>
                      </div>
                    </div>
                  )}
                  <input type="text" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} placeholder="Place name" className="w-full rounded-2xl px-4 py-3 mb-2.5 outline-none" style={{ background: "#FAF3E3", boxShadow: "inset 0 0 0 1.5px rgba(232, 99, 45, 0.35)", fontSize: 17, fontWeight: 500, color: "#2A2218" }} />
                  <textarea value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes (optional)" rows={3} className="w-full rounded-2xl px-4 py-3 mb-2.5 outline-none resize-none" style={{ background: "#FAF3E3", boxShadow: "inset 0 0 0 1px rgba(92, 69, 48, 0.15)", fontSize: 14, color: "#2A2218" }} />
                  {!editPhoto && (
                    <button onClick={() => editFileInputRef.current?.click()} className="w-full rounded-2xl py-3 mb-3 flex items-center justify-center gap-2 text-[13px] font-bold uppercase tracking-wider" style={{ background: "#FAF3E3", color: "#5C4530", boxShadow: "inset 0 0 0 1px rgba(92, 69, 48, 0.15)" }}>
                      <Camera size={14} strokeWidth={2.4} />Add a Photo
                    </button>
                  )}
                  <p className="text-[11px] uppercase tracking-[0.2em] font-bold mb-2 px-1" style={{ color: "#7A6B58" }}>Category</p>
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {CATEGORY_ORDER.map((key) => {
                      const cat = CATEGORIES[key];
                      const isActive = (editForm.categoryOverride || categorize(editForm.name)) === key;
                      return (
                        <button key={key} onClick={() => setEditForm((f) => ({ ...f, categoryOverride: f.categoryOverride === key ? null : key }))} className="px-3 py-1.5 rounded-full text-[12px] font-bold flex items-center gap-1.5 transition-all" style={{ background: isActive ? cat.color : cat.soft, color: isActive ? "white" : cat.color }}>
                          <span>{cat.emoji}</span>{cat.label}
                        </button>
                      );
                    })}
                  </div>
                  {editForm.categoryOverride && (
                    <button onClick={() => setEditForm((f) => ({ ...f, categoryOverride: null }))} className="text-[11px] uppercase tracking-wider font-bold mb-3 underline" style={{ color: "#7A6B58" }}>Reset to auto</button>
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Share app sheet */}
        <AnimatePresence>
          {shareAppOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShareAppOpen(false)} className="absolute inset-0 z-40" style={{ background: "rgba(42, 34, 24, 0.45)" }} />
              <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", stiffness: 300, damping: 32 }} className="absolute bottom-0 left-0 right-0 z-50 rounded-t-[28px] p-6 pb-8 overflow-hidden" style={{ background: "#F2E8D5", boxShadow: "0 -12px 40px -10px rgba(42, 34, 24, 0.3)" }}>
                <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: topoPattern, backgroundSize: "600px 600px", opacity: 0.35 }} />
                <div className="absolute inset-0 pointer-events-none mix-blend-multiply" style={{ backgroundImage: grainPattern, opacity: 0.12 }} />
                <div className="relative">
                  <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: "rgba(92, 69, 48, 0.25)" }} />
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.25em] mb-1.5" style={{ color: "#7A6B58", fontWeight: 600 }}>Pass it on</p>
                      <h3 style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2, color: "#2A2218" }}>Share Save This Place</h3>
                    </div>
                    <button onClick={() => setShareAppOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(92, 69, 48, 0.1)" }}><X size={15} strokeWidth={2.4} color="#5C4530" /></button>
                  </div>
                  <p className="text-[14px] mb-5" style={{ color: "#5C4530" }}>Send the app to a friend so they can save their own spots. Each person gets their own account.</p>
                  <motion.button onClick={shareApp} whileTap={{ scale: 0.98 }} className="relative w-full py-4 rounded-2xl flex items-center justify-center gap-2 text-[16px] font-bold overflow-hidden mb-2.5" style={{ background: "radial-gradient(circle at 30% 20%, #FF9560 0%, #E8632D 60%, #B83E10 100%)", color: "white", boxShadow: "0 12px 28px -10px rgba(184, 62, 16, 0.55), inset 0 -3px 8px rgba(0,0,0,0.15)" }}>
                    <div className="absolute inset-0 pointer-events-none mix-blend-overlay" style={{ backgroundImage: grainPattern, opacity: 0.3 }} />
                    <Send size={17} strokeWidth={2.4} className="relative" /><span className="relative">Share the App</span>
                  </motion.button>
                  <button onClick={async () => { const ok = await copyText(window.location.origin); showToast(ok ? "Link copied" : "Couldn't copy"); setShareAppOpen(false); }} className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 text-[13px] font-bold uppercase tracking-wider" style={{ background: "#FAF3E3", color: "#5C4530", boxShadow: "inset 0 0 0 1.5px rgba(92, 69, 48, 0.2)" }}>
                    <Copy size={13} strokeWidth={2.4} />Copy Link
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {toast && (
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} transition={{ duration: 0.2 }} className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-full flex items-center gap-2 text-[13px] font-semibold whitespace-nowrap" style={{ background: "#2A2218", color: "#F2E8D5", boxShadow: "0 12px 32px -10px rgba(42, 34, 24, 0.5)" }}>
              <Check size={14} strokeWidth={2.6} />{toast}
            </motion.div>
          )}
        </AnimatePresence>

        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
