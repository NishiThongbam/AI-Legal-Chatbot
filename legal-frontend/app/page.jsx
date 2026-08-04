"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Scale, Briefcase, Star, Mail, Loader2, LogOut, Lock, Paperclip, Calendar, Clock, CheckCircle, X, Trash2, CalendarDays, Video, Banknote, UploadCloud } from 'lucide-react';
import { getStorage, ref, uploadBytes, getDownloadURL, listAll, getMetadata, deleteObject } from 'firebase/storage';
import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getAuth,
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut,
  updateProfile 
} from 'firebase/auth';

import BookingInterface from "./BookingInterface";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const firebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(firebaseApp);
const storage = getStorage(firebaseApp);

export default function App() {
  // --- AUTHENTICATION STATE ---
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login'); 
  const [name, setName]= useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');


// --- CHAT STATE1 --- ///
  const [chatMode, setChatMode] = useState('intake');


  // --- CHAT STATE2 ---
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'bot',
      type: 'text',
      content: 'Hello. I am the legal intake assistant. Please briefly describe your legal issue, and I will connect you with the right specialist.',
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  
  // NEW: State for tracking individual required document verification
  const [docStatuses, setDocStatuses] = useState({});

  // --- SCHEDULING STATE ---
  const [selectedLawyer, setSelectedLawyer] = useState(null); 
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);

  // --- APPOINTMENTS STATE ---
  const [isAppointmentsOpen, setIsAppointmentsOpen] = useState(false);
  const [userAppointments, setUserAppointments] = useState([]);
  const [isLoadingAppointments, setIsLoadingAppointments] = useState(false);
  const [cancelingAptId, setCancelingAptId] = useState(null);

  // --- VAULT STATE ---
  const [isVaultOpen, setIsVaultOpen] = useState(false);
  const [userDocuments, setUserDocuments] = useState([]);
  const [isLoadingVault, setIsLoadingVault] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState(null);

  // --- HANDLER: Fetch User Documents ---
  const handleOpenVault = async () => {
    setIsVaultOpen(true);
    setIsLoadingVault(true);
    
    try {
      const folderRef = ref(storage, `users/${user.uid}/documents`);
      const response = await listAll(folderRef);
      
      const docs = await Promise.all(response.items.map(async (itemRef) => {
        const url = await getDownloadURL(itemRef);
        const metadata = await getMetadata(itemRef);
        
        const cleanName = itemRef.name.split('_').slice(1).join('_') || itemRef.name;
        
        return {
          id: itemRef.name,
          name: cleanName,
          url: url,
          date: new Date(metadata.timeCreated).toLocaleString('en-US', {
            month: 'short', 
            day: 'numeric', 
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          })
        };
      }));
      
      setUserDocuments(docs.sort((a, b) => new Date(b.date) - new Date(a.date)));
    } catch (error) {
      console.error("Error fetching vault documents:", error);
    } finally {
      setIsLoadingVault(false);
    }
  };

  // --- HANDLER: Fetch User Appointments ---
  const handleOpenAppointments = async () => {
    setIsAppointmentsOpen(true);
    setIsLoadingAppointments(true);
    
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/appointments?email=${encodeURIComponent(user.email)}`);
      
      if (response.ok) {
        const data = await response.json();
        setUserAppointments(data.appointments || []);
      }
    } catch (error) {
      console.error("Error fetching appointments:", error);
    } finally {
      setIsLoadingAppointments(false);
    }
  };

  // --- HANDLER: Cancel User Appointment ---
  const handleCancelAppointment = async (eventId) => {
    if (!window.confirm("Are you sure you want to cancel this consultation? This will remove it from the lawyer's calendar.")) return;

    setCancelingAptId(eventId);
    try {
      const response = await fetch(`http://127.0.0.1:8000/api/appointments/${eventId}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to cancel appointment');

      // Instantly remove the appointment from the UI without reloading
      setUserAppointments((prev) => prev.filter((apt) => apt.id !== eventId));
    } catch (error) {
      console.error("Error canceling appointment:", error);
      alert("Failed to cancel the appointment. Please try again.");
    } finally {
      setCancelingAptId(null);
    }
  };

  // --- HANDLER: Delete User Document ---
  const handleDeleteDocument = async (fileName) => {
    if (!window.confirm("Are you sure you want to permanently delete this document?")) return;

    setDeletingDocId(fileName);
    try {
      const fileRef = ref(storage, `users/${user.uid}/documents/${fileName}`);
      await deleteObject(fileRef);

      setUserDocuments((prevDocs) => prevDocs.filter((doc) => doc.id !== fileName));
    } catch (error) {
      console.error("Error deleting document:", error);
      alert("Failed to delete the document. Please try again.");
    } finally {
      setDeletingDocId(null);
    }
  };

  // --- EFFECT: Listen for User Login/Logout ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- EFFECT: Auto-scroll Chat ---
  useEffect(() => {
    if (user) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, user]);

  // --- HANDLER: Authentication ---
  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (authMode === 'signup') {
        // 1. Create the user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        
        // 2. Attach the name to their Firebase profile
        await updateProfile(userCredential.user, { displayName: name });
        
        // 3. Force React to recognize the new name instantly
        setUser({ ...userCredential.user, displayName: name });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      setAuthError(error.message.replace('Firebase: ', ''));
    }
  };

  // --- HANDLER: Logout ---
  const handleLogout = async () => {
    try {
      await signOut(auth);
      setMessages([{
        id: 1,
        role: 'bot',
        type: 'text',
        content: 'Hello. I am the legal intake assistant. Please briefly describe your legal issue, and I will connect you with the right specialist.',
      }]);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  // --- HANDLER: Specific Document Verification & Upload ---
  const handleSpecificDocumentUpload = async (e, expectedType) => {
    const file = e.target.files[0];
    if (!file || !user) return;

    // 1. Mark this specific document as uploading in the UI
    setDocStatuses(prev => ({ ...prev, [expectedType]: 'uploading' }));

    const formData = new FormData();
    formData.append('file', file);
    formData.append('expected_type', expectedType);

    try {
      // 2. Hit the isolated FastAPI verification endpoint
      const response = await fetch('http://127.0.0.1:8000/verify-document', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Verification request failed');
      const data = await response.json();

      if (data.verified) {
        // 3. If the AI verifies it, securely save it to the Firebase Vault
        const fileRef = ref(storage, `users/${user.uid}/documents/${Date.now()}_${file.name}`);
        await uploadBytes(fileRef, file);

        // 4. Update the local UI to show a green success checkmark
        setDocStatuses(prev => ({ ...prev, [expectedType]: 'verified' }));
      } else {
        // AI rejected the document
        setDocStatuses(prev => ({ ...prev, [expectedType]: 'failed' }));
        alert(`AI Verification Failed: The file does not appear to be a ${expectedType}.`);
      }
    } catch (error) {
      console.error("Upload/Verification failed:", error);
      setDocStatuses(prev => ({ ...prev, [expectedType]: 'failed' }));
    }
  };

  // --- HANDLER: Document Upload with Secure Storage & Duplicate Check ---
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user) return;
    
    if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) {
      alert('Please upload a PDF or an Image (JPG/PNG).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const MAX_FILE_SIZE_MB = 5;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    
    if (file.size > MAX_FILE_SIZE_BYTES) {
      alert(`Upload blocked: Your file is larger than the ${MAX_FILE_SIZE_MB}MB limit. Please compress your document or choose a smaller file.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setIsLoading(true);

    try {
      const folderRef = ref(storage, `users/${user.uid}/documents`);
      const existingFiles = await listAll(folderRef);
      
      const isDuplicate = existingFiles.items.some((itemRef) => {
        const originalName = itemRef.name.substring(itemRef.name.indexOf('_') + 1);
        return originalName === file.name;
      });

      if (isDuplicate) {
        setMessages((prev) => [...prev, {
          id: Date.now(),
          role: 'bot',
          type: 'text',
          content: `⚠️ Upload canceled. A document named "${file.name}" already exists in your vault. Please rename the file if this is a new document, or check your vault to view the existing one.`
        }]);
        return;
      }

      const fileRef = ref(storage, `users/${user.uid}/documents/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      const downloadURL = await getDownloadURL(fileRef);

      const newUserMsg = { 
        id: Date.now(), 
        role: 'user', 
        type: 'document', 
        name: file.name,
        url: downloadURL 
      };
      setMessages((prev) => [...prev, newUserMsg]);

      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://127.0.0.1:8000/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();

      const botTextMsg = { id: Date.now() + 1, role: 'bot', type: 'text', content: data.reasoning };
      const botChecklistMsg = { id: Date.now() + 2, role: 'bot', type: 'checklist', documents: data.required_documents || [] };
      const botLawyerMsg = { id: Date.now() + 3, role: 'bot', type: 'lawyers', lawyers: data.recommended_lawyers, category: data.detected_category };

      setMessages((prev) => [...prev, botTextMsg, botChecklistMsg, botLawyerMsg]);

    } catch (error) {
      console.error("Upload error:", error);
      setMessages((prev) => [...prev, {
        id: Date.now() + 1, role: 'bot', type: 'text', content: 'Sorry, an error occurred while processing your document.'
      }]);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /// --- HANDLER: Send Chat Message ---
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userText = inputValue;
    setInputValue('');
    
    const newUserMsg = { id: Date.now(), role: 'user', type: 'text', content: userText };
    setMessages((prev) => [...prev, newUserMsg]);
    setIsLoading(true);

    try {
      // NEW: Branch logic based on chat mode
      if (chatMode === 'general') {
        
        // 1. Create the "Short-Term Memory"
        // We filter for 'text' only so we don't accidentally send the AI its own UI checklists or lawyer objects
        const shortTermMemory = messages
            .filter(msg => msg.type === 'text')
            .slice(-4) // Only grab the last 4 messages ("not a lot")
            .map(msg => ({
                role: msg.role === 'bot' ? 'assistant' : 'user',
                content: msg.content
            }));

        // 2. Send the new message PLUS the memory
        const response = await fetch('http://127.0.0.1:8000/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
              user_message: userText,
              history: shortTermMemory
          }),
        });

        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();

        setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'bot', type: 'text', content: data.reply }]);
        
      } else {
        // EXISTING: Intake Routing Logic
        const response = await fetch('http://127.0.0.1:8000/api/intake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_message: userText }),
        });

        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();

        const botTextMsg = { id: Date.now() + 1, role: 'bot', type: 'text', content: `Based on your description, this sounds like an issue related to ${data.detected_category}. ${data.reasoning}` };
        const botChecklistMsg = { id: Date.now() + 2, role: 'bot', type: 'checklist', documents: data.required_documents || [] };
        const botLawyerMsg = { id: Date.now() + 3, role: 'bot', type: 'lawyers', lawyers: data.recommended_lawyers, category: data.detected_category };

        setMessages((prev) => [...prev, botTextMsg, botChecklistMsg, botLawyerMsg]);
      }

    } catch (error) {
      setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'bot', type: 'text', content: 'Sorry, I am having trouble connecting to the database right now. Please try again later.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!scheduleDate) {
      setAvailableSlots([]);
      return;
    }

    const fetchAvailability = async () => {
      setIsLoadingSlots(true);
      try {
        const response = await fetch(`http://127.0.0.1:8000/api/availability?date=${scheduleDate}`);
        if (response.ok) {
          const data = await response.json();
          setAvailableSlots(data.available_slots || []);
        }
      } catch (error) {
        console.error("Failed to fetch availability:", error);
      } finally {
        setIsLoadingSlots(false);
      }
    };

    fetchAvailability();
  }, [scheduleDate]);

  // --- HANDLER: Book Consultation ---
  const handleScheduleSubmit = async (e) => {
    e.preventDefault();
    if (!scheduleDate || !scheduleTime) return;
    setIsScheduling(true);

    try {
      // 1. Book the Google Calendar Appointment
      const response = await fetch('http://127.0.0.1:8000/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lawyer_name: selectedLawyer.lawyer_name,
          user_email: user.email,
          date: scheduleDate,
          time: scheduleTime
        }),
      });

      if (!response.ok) throw new Error('Failed to book appointment');
      const data = await response.json();

      // 2. Generate a unique Token ID
      const tokenId = `TOK-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
      const clientName = user.displayName || user.email;

      // 3. Request the PDF from FastAPI
      const tokenResponse = await fetch('http://127.0.0.1:8000/api/generate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token_id: tokenId,
          client_email: user.email,
          client_name: clientName,
          lawyer_name: selectedLawyer.lawyer_name,
          date: scheduleDate,
          time: scheduleTime
        }),
      });

      let downloadURL = null;

      if (tokenResponse.ok) {
         // 4. Convert the FastAPI response into a physical file and upload to Firebase Vault
         const pdfBlob = await tokenResponse.blob();
         const file = new File([pdfBlob], `${tokenId}_Consultation_Pass.pdf`, { type: 'application/pdf' });
         
         const fileRef = ref(storage, `users/${user.uid}/documents/${file.name}`);
         await uploadBytes(fileRef, file);
         downloadURL = await getDownloadURL(fileRef);
      }

      // 5. Update the Chat UI 
      const successMsg = {
        id: Date.now(),
        role: 'bot',
        type: 'text',
        content: `✅ Success! Your consultation with ${selectedLawyer.lawyer_name} is booked for ${scheduleDate} at ${scheduleTime}. \n\nVirtual Meet Link: ${data.meet_link}`
      };
      
      setMessages((prev) => [...prev, successMsg]);

      // If the PDF generated successfully, push it to the chat as a clickable document bubble!
      if (downloadURL) {
        setMessages((prev) => [...prev, {
          id: Date.now() + 1,
          role: 'bot',
          type: 'document', 
          name: "In-Person Consultation Pass.pdf",
          url: downloadURL
        }]);
      }

      setSelectedLawyer(null);
      setScheduleDate('');
      setScheduleTime('');
    } catch (error) {
      console.error("Booking error:", error);
      alert("Failed to book the consultation. Please try again.");
    } finally {
      setIsScheduling(false);
    }
  };

  // --- UI RENDER: Loading State ---
  if (isAuthLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-blue-600" size={48} />
      </div>
    );
  }

  // --- UI RENDER: Login / Signup Screen ---
  if (!user) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 font-sans">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-200">
          <div className="flex justify-center mb-6">
            <div className="bg-blue-100 p-4 rounded-full text-blue-600">
              <Lock size={32} />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-slate-800 mb-2">Welcome to LegalConnect</h2>
          <p className="text-center text-slate-500 mb-8">{authMode === 'login' ? 'Sign in to your account' : 'Create a secure account'}</p>

          {authError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 border border-red-200">{authError}</div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            {/* NEW: Only show Name field during signup */}
            {authMode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input 
                  type="text" 
                  required 
                  value={name} 
                  onChange={(e) => setName(e.target.value)} 
                  className="w-full border border-slate-300 rounded-lg px-4 py-2 text-black focus:ring-2 focus:ring-blue-500 focus:outline-none" 
                  placeholder="John Doe" 
                />
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-slate-300 rounded-lg px-4 py-2 text-black focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="you@example.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-slate-300 rounded-lg px-4 py-2 text-black focus:ring-2 focus:ring-blue-500 focus:outline-none" placeholder="••••••••" />
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white font-medium py-2.5 rounded-lg hover:bg-blue-700 transition-colors mt-2">
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-slate-500">
            {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(''); }} className="text-blue-600 font-medium hover:underline focus:outline-none">
              {authMode === 'login' ? 'Sign Up' : 'Log In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- UI RENDER: Main Chat Interface ---
  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans relative">
      
      {/* SCHEDULING MODAL */}
      {selectedLawyer && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-blue-600 p-4 flex justify-between items-center text-white">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Calendar size={20} /> Book Consultation
              </h3>
              <button onClick={() => setSelectedLawyer(null)} className="hover:bg-blue-700 p-1 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6">
              <div className="mb-6 flex items-center gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="bg-blue-100 text-blue-600 p-3 rounded-full">
                  <Briefcase size={24} />
                </div>
                <div>
                  <p className="text-sm text-slate-500 font-medium">Selected Specialist</p>
                  <p className="font-semibold text-slate-900 text-lg">{selectedLawyer.lawyer_name}</p>
                </div>
              </div>

              <form onSubmit={handleScheduleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Select Date</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input 
                      type="date" 
                      required
                      min={new Date().toISOString().split('T')[0]} 
                      value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      className="w-full border border-slate-300 text-black rounded-lg py-2.5 pl-10 pr-4 focus:ring-2 focus:ring-blue-500 focus:outline-none" 
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Select Time</label>
                  <div className="relative">
                    <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <select 
                      required
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      disabled={isLoadingSlots || !scheduleDate}
                      className="w-full border border-slate-300 text-black rounded-lg py-2.5 pl-10 pr-4 focus:ring-2 focus:ring-blue-500 focus:outline-none appearance-none disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="" disabled>
                        {isLoadingSlots ? "Loading slots..." : !scheduleDate ? "Select a date first" : availableSlots.length === 0 ? "No slots available" : "Choose a time slot"}
                      </option>
                      
                      {availableSlots.map((slot) => (
                        <option key={slot} value={slot}>
                          {slot}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setSelectedLawyer(null)} className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors font-medium">
                    Cancel
                  </button>
                  <button type="submit" disabled={isScheduling} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-70">
                    {isScheduling ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />}
                    {isScheduling ? 'Booking...' : 'Confirm'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* VAULT MODAL */}
      {isVaultOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
            
            <div className="bg-slate-900 p-4 flex justify-between items-center text-white">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Lock size={20} className="text-blue-400" /> Secure Document Vault
              </h3>
              <button onClick={() => setIsVaultOpen(false)} className="hover:bg-slate-700 p-1 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50">
              {isLoadingVault ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-3">
                  <Loader2 size={32} className="animate-spin text-blue-600" />
                  <p>Decrypting vault contents...</p>
                </div>
              ) : userDocuments.length === 0 ? (
                <div className="text-center py-10 text-slate-500 bg-white border border-slate-200 rounded-xl">
                  <Paperclip size={48} className="mx-auto text-slate-300 mb-3" />
                  <p className="font-medium text-slate-700">Your vault is empty.</p>
                  <p className="text-sm mt-1">Documents you upload during intake will appear here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {userDocuments.map((doc) => (
                    <div key={doc.id} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex items-center justify-between gap-4 hover:shadow-md transition-shadow">
                      
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="bg-blue-50 text-blue-600 p-2.5 rounded-lg flex-shrink-0">
                          <Paperclip size={20} />
                        </div>
                        <div className="truncate">
                          <p className="font-medium text-slate-900 truncate" title={doc.name}>{doc.name}</p>
                          <p className="text-xs font-medium text-slate-500 mt-0.5">
                            Submitted: <span className="text-slate-700">{doc.date}</span>
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex-shrink-0 flex items-center gap-2">
                        <a 
                          href={doc.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
                        >
                          View
                        </a>
                        
                        <button 
                          onClick={() => handleDeleteDocument(doc.id)}
                          disabled={deletingDocId === doc.id}
                          className="p-2 text-red-500 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors disabled:opacity-50"
                          title="Delete Document"
                        >
                          {deletingDocId === doc.id ? (
                            <Loader2 size={18} className="animate-spin" />
                          ) : (
                            <Trash2 size={18} />
                          )}
                        </button>
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* APPOINTMENTS MODAL */}
      {isAppointmentsOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[80vh]">
            
            <div className="bg-slate-900 p-4 flex justify-between items-center text-white">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <CalendarDays size={20} className="text-blue-400" /> My Appointments
              </h3>
              <button onClick={() => setIsAppointmentsOpen(false)} className="hover:bg-slate-700 p-1 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-slate-50">
              {isLoadingAppointments ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-3">
                  <Loader2 size={32} className="animate-spin text-blue-600" />
                  <p>Syncing schedule...</p>
                </div>
              ) : userAppointments.length === 0 ? (
                <div className="text-center py-10 text-slate-500 bg-white border border-slate-200 rounded-xl">
                  <Calendar size={48} className="mx-auto text-slate-300 mb-3" />
                  <p className="font-medium text-slate-700">No upcoming appointments.</p>
                  <p className="text-sm mt-1">Book a consultation through the chat.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {userAppointments.map((apt) => (
                    <div key={apt.id} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between gap-4">
                        
                        <div>
                          <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">Upcoming Consultation</p>
                          <p className="font-semibold text-slate-900 text-lg">{apt.lawyer_name}</p>
                          <div className="flex items-center gap-4 mt-2 text-sm text-slate-600">
                            <span className="flex items-center gap-1.5"><Calendar size={16} className="text-slate-400" /> {apt.date}</span>
                            <span className="flex items-center gap-1.5"><Clock size={16} className="text-slate-400" /> {apt.time}</span>
                          </div>
                        </div>

                        <div className="flex-shrink-0 flex items-center gap-2">
                          <a 
                            href={apt.meet_link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                          >
                            <Video size={16} /> Join Meet
                          </a>
                          
                          <button 
                            onClick={() => handleCancelAppointment(apt.id)}
                            disabled={cancelingAptId === apt.id}
                            className="p-2.5 text-red-500 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors disabled:opacity-50 border border-transparent hover:border-red-100"
                            title="Cancel Appointment"
                          >
                            {cancelingAptId === apt.id ? (
                              <Loader2 size={18} className="animate-spin" />
                            ) : (
                              <Trash2 size={18} />
                            )}
                          </button>
                        </div>
                        
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-slate-900 text-white p-4 shadow-md flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <Scale size={24} className="text-blue-400" />
          <h1 className="text-xl font-semibold tracking-wide">LegalConnect Intake</h1>
        </div>
        
        <div className="flex items-center gap-4">
            <div className="text-sm text-slate-300 hidden sm:block font-medium">
              {user.displayName || user.email}
            </div>
            <button onClick={handleOpenVault} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg transition-colors text-sm font-medium">
                <Paperclip size={16} /><span>My Vault</span>
            </button>

            <button onClick={handleOpenAppointments} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors text-sm font-medium">
                <CalendarDays size={16} /><span>Appointments</span>
            </button>

            <button onClick={handleLogout} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors text-sm">
                <LogOut size={16} /><span>Logout</span>
            </button>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 w-full max-w-4xl mx-auto space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            
            {/* Standard Text Message */}
            {msg.type === 'text' && (
              <div className={`flex items-end gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-white'}`}>
                  {msg.role === 'user' ? <User size={16} /> : <Scale size={16} />}
                </div>
                <div className={`p-4 rounded-2xl shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none'}`}>
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            )}

            {/* Document Upload Message */}
            {msg.type === 'document' && (
              <div className={`flex items-end gap-2 max-w-[85%] flex-row-reverse`}>
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm bg-blue-600 text-white`}>
                  <User size={16} />
                </div>
                <div className={`p-4 rounded-2xl shadow-sm bg-blue-600 text-white rounded-br-none`}>
                   <div className="flex items-center gap-2 font-medium">
                     <Paperclip size={18} />
                     <a href={msg.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-200 truncate max-w-[200px] sm:max-w-[300px]">
                       {msg.name}
                     </a>
                   </div>
                   <p className="text-xs text-blue-200 mt-1 flex items-center gap-1">
                     <CheckCircle size={12} /> Saved securely to your vault
                   </p>
                </div>
              </div>
            )}

            {/* Document Checklist Message */}
            {msg.type === 'checklist' && msg.documents.length > 0 && (
              <div className="mt-2 ml-10 w-full max-w-2xl bg-blue-50/50 border border-blue-100 p-5 rounded-xl shadow-sm">
                <div className="flex items-center gap-2 text-blue-800 font-semibold mb-3">
                  <Paperclip size={18} />
                  <h4>Required Documents to Upload</h4>
                </div>
                
                <ul className="space-y-3 mb-4">
                  {msg.documents.map((doc, idx) => (
                    <li key={idx} className="flex items-center justify-between gap-2 text-sm text-slate-700 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-2">
                         <div className="text-blue-500"><CheckCircle size={14} /></div>
                         <span className="font-medium">{doc}</span>
                      </div>
                      
                      {/* Dynamic Status UI */}
                      <div className="flex items-center shrink-0">
                        {(!docStatuses[doc] || docStatuses[doc] === 'pending') && (
                          <label className="cursor-pointer bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-700 transition-colors text-xs flex items-center gap-1.5 shadow-sm">
                            <UploadCloud size={14} /> Upload
                            <input type="file" className="hidden" accept=".pdf, image/jpeg, image/png" onChange={(e) => handleSpecificDocumentUpload(e, doc)} />
                          </label>
                        )}
                        
                        {docStatuses[doc] === 'uploading' && (
                          <span className="flex items-center gap-1.5 text-slate-500 text-xs font-medium">
                            <Loader2 size={14} className="animate-spin text-blue-600" /> Analyzing...
                          </span>
                        )}
                        
                        {docStatuses[doc] === 'verified' && (
                          <span className="flex items-center gap-1.5 text-green-600 text-xs font-bold bg-green-50 px-2 py-1 rounded">
                            <CheckCircle size={16} /> Verified & Saved
                          </span>
                        )}
                        
                        {docStatuses[doc] === 'failed' && (
                          <label className="cursor-pointer text-red-500 hover:text-red-700 text-xs font-medium underline flex items-center gap-1">
                            <X size={14} /> Retry Upload
                            <input type="file" className="hidden" accept=".pdf, image/jpeg, image/png" onChange={(e) => handleSpecificDocumentUpload(e, doc)} />
                          </label>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                
                <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500">Files verified by AI are securely saved directly to your vault.</span>
                </div>
              </div>
            )}

            {/* Lawyer Recommendation Message */}
            {msg.type === 'lawyers' && (
              <div className="mt-2 ml-10 w-full max-w-2xl space-y-3">
                <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Recommended {msg.category} Specialists</p>
                {msg.lawyers.length > 0 ? (
                  msg.lawyers.map((lawyer, idx) => (
                    <div key={idx} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-4">
                        <div className="flex-shrink-0 bg-blue-100 text-blue-700 p-3 rounded-full">
                          <Briefcase size={24} />
                        </div>
                        
                        {/* NEW: Added wrapper div and lawyer name header */}
                        <div>
                          <h4 className="font-semibold text-slate-900 text-base">{lawyer.lawyer_name}</h4>
                          
                          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500 mt-1">
                              {/* Rating */}
                              <span className="flex items-center gap-1">
                                <Star size={14} className="text-amber-400 fill-amber-400" />
                                {lawyer.rating}
                              </span>
                              
                              {/* Hourly Rate */}
                              <span className="flex items-center gap-1 font-medium text-slate-700 bg-green-50 px-2 py-0.5 rounded-md border border-green-100">
                                <Banknote size={14} className="text-green-600" />
                                ${lawyer.hourly_rate}/hr
                              </span>
                              
                              {/* Email */}
                              <span className="flex items-center gap-1">
                                <Mail size={14} />
                                {lawyer.contact_email}
                              </span>
                            </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => setSelectedLawyer(lawyer)}
                        className="bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors w-full sm:w-auto"
                      >
                        Book Consultation
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl text-sm">
                    We currently do not have any {msg.category} specialists available in our network.
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        
        {isLoading && (
          <div className="flex items-start gap-2 max-w-[85%]">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center shadow-sm">
              <Scale size={16} />
            </div>
            <div className="bg-white text-slate-800 border border-slate-200 p-4 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-2">
              <Loader2 size={18} className="animate-spin text-blue-600" />
              <span className="text-sm text-slate-500">Analyzing context...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Form & Mode Toggle */}
      <footer className="bg-white border-t border-slate-200 p-4">
        <div className="max-w-4xl mx-auto">
          
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full">
            {/* MOVED TO LEFT: Chat Mode Toggle */}
            <div className="flex-shrink-0 flex bg-slate-100 rounded-full p-1 border border-slate-200 w-full sm:w-auto">
              <button 
                onClick={() => setChatMode('intake')}
                className={`flex-1 sm:flex-none px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-200 ${chatMode === 'intake' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Booking
              </button>
              <button 
                onClick={() => setChatMode('general')}
                className={`flex-1 sm:flex-none px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-200 ${chatMode === 'general' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Chat
              </button>
            </div>

            {/* Chat Input */}
            <form onSubmit={handleSendMessage} className="relative flex items-center flex-1 w-full">
              <input type="file" accept=".pdf, image/jpeg, image/jpg, image/png" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading} className="absolute left-2 text-slate-400 hover:text-blue-600 p-2 rounded-full transition-colors disabled:opacity-50 z-10" title="Upload Legal Document (PDF) or Image (PNG/JPG)">
                <Paperclip size={20} />
              </button>
              <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} disabled={isLoading} placeholder="Describe your issue or attach a document..." className="w-full bg-slate-50 border border-slate-300 rounded-full py-3.5 pl-12 pr-14 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50" />
              <button type="submit" disabled={isLoading || !inputValue.trim()} className="absolute right-2 bg-blue-600 text-white p-2 rounded-full hover:bg-blue-700 disabled:opacity-50 transition-colors">
                <Send size={18} />
              </button>
            </form>
          </div>
          
          <p className="text-center text-xs text-slate-400 mt-3">This AI assistant routes your inquiry but does not provide official legal advice.</p>
        </div>
      </footer>

    </div>
  );
}