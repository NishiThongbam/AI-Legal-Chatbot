"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Scale, Briefcase, Star, Mail, Loader2, LogOut, Lock, Paperclip, Calendar, Clock, CheckCircle, X } from 'lucide-react';

import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth,
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut 
} from 'firebase/auth';
// NEW: Import Firebase Storage tools
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

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
// NEW: Initialize Storage
const storage = getStorage(firebaseApp);

export default function App() {
  // --- AUTHENTICATION STATE ---
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login'); 
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // --- CHAT STATE ---
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

  // --- SCHEDULING STATE ---
  const [selectedLawyer, setSelectedLawyer] = useState(null); 
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);

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
        await createUserWithEmailAndPassword(auth, email, password);
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

  // --- HANDLER: Document Upload with Secure Storage ---
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !user) return;
    
    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF document.');
      return;
    }

    setIsLoading(true);

    try {
      // 1. SECURE STORAGE: Upload the file to Firebase Storage
      // We save it inside a specific folder named after the user's unique ID
      const fileRef = ref(storage, `users/${user.uid}/documents/${Date.now()}_${file.name}`);
      await uploadBytes(fileRef, file);
      
      // Get the secure, clickable download URL
      const downloadURL = await getDownloadURL(fileRef);

      // 2. Add the document message to the chat UI
      const newUserMsg = { 
        id: Date.now(), 
        role: 'user', 
        type: 'document', 
        name: file.name,
        url: downloadURL 
      };
      setMessages((prev) => [...prev, newUserMsg]);

      // 3. AI ANALYSIS: Send the raw file to your Python backend for reading
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('http://127.0.0.1:8000/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();

      const botTextMsg = { id: Date.now() + 1, role: 'bot', type: 'text', content: data.reasoning };
      const botLawyerMsg = { id: Date.now() + 2, role: 'bot', type: 'lawyers', lawyers: data.recommended_lawyers, category: data.detected_category };

      setMessages((prev) => [...prev, botTextMsg, botLawyerMsg]);

    } catch (error) {
      console.error("Upload error:", error);
      setMessages((prev) => [...prev, {
        id: Date.now() + 1, role: 'bot', type: 'text', content: 'Sorry, an error occurred while uploading or analyzing your document.'
      }]);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- HANDLER: Send Chat Message ---
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    const userText = inputValue;
    setInputValue('');
    
    const newUserMsg = { id: Date.now(), role: 'user', type: 'text', content: userText };
    setMessages((prev) => [...prev, newUserMsg]);
    setIsLoading(true);

    try {
      const response = await fetch('http://127.0.0.1:8000/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_message: userText }),
      });

      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();

      const botTextMsg = { id: Date.now() + 1, role: 'bot', type: 'text', content: `Based on your description, this sounds like an issue related to ${data.detected_category}. ${data.reasoning}` };
      const botLawyerMsg = { id: Date.now() + 2, role: 'bot', type: 'lawyers', lawyers: data.recommended_lawyers, category: data.detected_category };

      setMessages((prev) => [...prev, botTextMsg, botLawyerMsg]);

    } catch (error) {
      setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'bot', type: 'text', content: 'Sorry, I am having trouble connecting to the legal database right now. Please try again later.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  // --- HANDLER: Book Consultation ---
  const handleScheduleSubmit = async (e) => {
    e.preventDefault();
    if (!scheduleDate || !scheduleTime) return;
    setIsScheduling(true);

    try {
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

      setMessages((prev) => [...prev, {
        id: Date.now(),
        role: 'bot',
        type: 'text',
        content: `✅ Success! Your consultation with ${selectedLawyer.lawyer_name} is booked for ${scheduleDate} at ${scheduleTime}. A calendar invite has been sent to ${user.email}.`
      }]);

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
                      className="w-full border border-slate-300 text-black rounded-lg py-2.5 pl-10 pr-4 focus:ring-2 focus:ring-blue-500 focus:outline-none appearance-none"
                    >
                      <option value="" disabled>Choose a time slot</option>
                      <option value="09:00 AM">09:00 AM</option>
                      <option value="10:00 AM">10:00 AM</option>
                      <option value="11:30 AM">11:30 AM</option>
                      <option value="01:00 PM">01:00 PM</option>
                      <option value="02:30 PM">02:30 PM</option>
                      <option value="04:00 PM">04:00 PM</option>
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

      {/* Header */}
      <header className="bg-slate-900 text-white p-4 shadow-md flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <Scale size={24} className="text-blue-400" />
          <h1 className="text-xl font-semibold tracking-wide">LegalConnect Intake</h1>
        </div>
        <div className="flex items-center gap-4">
            <div className="text-sm text-slate-300 hidden sm:block">{user.email}</div>
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

            {/* Document Upload Message (NEW) */}
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

            {/* Lawyer Recommendation Message */}
            {msg.type === 'lawyers' && (
              <div className="mt-2 ml-10 w-full max-w-2xl space-y-3">
                <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">Recommended {msg.category} Specialists</p>
                {msg.lawyers.length > 0 ? (
                  msg.lawyers.map((lawyer, idx) => (
                    <div key={idx} className="bg-white border border-slate-200 p-4 rounded-xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-md transition-shadow">
                      <div className="flex items-center gap-4">
                        <div className="bg-blue-100 text-blue-700 p-3 rounded-full">
                          <Briefcase size={24} />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900 text-lg">{lawyer.lawyer_name}</h3>
                          <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
                            <span className="flex items-center gap-1"><Star size={14} className="text-amber-400 fill-amber-400" />{lawyer.rating}</span>
                            <span className="flex items-center gap-1"><Mail size={14} />{lawyer.contact_email}</span>
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

      {/* Input Form */}
      <footer className="bg-white border-t border-slate-200 p-4">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto relative flex items-center">
          <input type="file" accept=".pdf" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoading} className="absolute left-2 text-slate-400 hover:text-blue-600 p-2 rounded-full transition-colors disabled:opacity-50 z-10" title="Upload Legal Document (PDF)">
            <Paperclip size={20} />
          </button>
          <input type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)} disabled={isLoading} placeholder="Describe your issue or attach a document..." className="w-full bg-slate-50 border border-slate-300 rounded-full py-4 pl-12 pr-16 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50" />
          <button type="submit" disabled={isLoading || !inputValue.trim()} className="absolute right-2 bg-blue-600 text-white p-2.5 rounded-full hover:bg-blue-700 disabled:opacity-50 transition-colors">
            <Send size={20} />
          </button>
        </form>
        <p className="text-center text-xs text-slate-400 mt-3">This AI assistant routes your inquiry but does not provide official legal advice.</p>
      </footer>
    </div>
  );
}