"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Send, User, Scale, Briefcase, Star, Mail, Loader2, LogOut, Lock } from 'lucide-react';

import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth,
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut 
} from 'firebase/auth';

// REMOVED the getEnv function. Next.js requires literal process.env strings.
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

export default function App() {
  // --- AUTHENTICATION STATE ---
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
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
  
  const messagesEndRef = useRef(null);

  // --- EFFECT: Listen for User Login/Logout ---
  useEffect(() => {
    // This listener fires automatically whenever the user logs in or out
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
      setMessages([
          {
            id: 1,
            role: 'bot',
            type: 'text',
            content: 'Hello. I am the legal intake assistant. Please briefly describe your legal issue, and I will connect you with the right specialist.',
          }
        ]); // Reset chat on logout
    } catch (error) {
      console.error("Logout Error:", error);
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

      const botTextMsg = {
        id: Date.now() + 1,
        role: 'bot',
        type: 'text',
        content: `Based on your description, this sounds like an issue related to ${data.detected_category}. ${data.reasoning}`,
      };
      
      const botLawyerMsg = {
        id: Date.now() + 2,
        role: 'bot',
        type: 'lawyers',
        lawyers: data.recommended_lawyers,
        category: data.detected_category
      };

      setMessages((prev) => [...prev, botTextMsg, botLawyerMsg]);

    } catch (error) {
      console.error("Error communicating with backend:", error);
      setMessages((prev) => [...prev, {
        id: Date.now() + 1,
        role: 'bot',
        type: 'text',
        content: 'Sorry, I am having trouble connecting to the legal database right now. Please try again later.'
      }]);
    } finally {
      setIsLoading(false);
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
          <h2 className="text-2xl font-bold text-center text-slate-800 mb-2">
            Welcome to LegalConnect
          </h2>
          <p className="text-center text-slate-500 mb-8">
            {authMode === 'login' ? 'Sign in to your account' : 'Create a secure account'}
          </p>

          {authError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 border border-red-200">
              {authError}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-4 py-2 text-black focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input 
                type="password" 
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-4 py-2 text-black focus:ring-2 focus:ring-blue-500 focus:outline-none"
                
              />
            </div>
            <button 
              type="submit" 
              className="w-full bg-blue-600 text-white font-medium py-2.5 rounded-lg hover:bg-blue-700 transition-colors mt-2"
            >
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-slate-500">
            {authMode === 'login' ? "Don't have an account? " : "Already have an account? "}
            <button 
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'signup' : 'login');
                setAuthError('');
              }}
              className="text-blue-600 font-medium hover:underline focus:outline-none"
            >
              {authMode === 'login' ? 'Sign Up' : 'Log In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- UI RENDER: Main Chat Interface (Only shown if user is logged in) ---
  return (
    <div className="flex flex-col h-screen bg-slate-50 font-sans">
      {/* Header */}
      <header className="bg-slate-900 text-white p-4 shadow-md flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <Scale size={24} className="text-blue-400" />
          <h1 className="text-xl font-semibold tracking-wide">LegalConnect Intake</h1>
        </div>
        <div className="flex items-center gap-4">
            <div className="text-sm text-slate-300 hidden sm:block">
              {user.email}
            </div>
            <button 
                onClick={handleLogout}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg border border-slate-700 transition-colors text-sm"
            >
                <LogOut size={16} />
                <span>Logout</span>
            </button>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 w-full max-w-4xl mx-auto space-y-6">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            
            {msg.type === 'text' && (
              <div className={`flex items-end gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-white'}`}>
                  {msg.role === 'user' ? <User size={16} /> : <Scale size={16} />}
                </div>
                <div className={`p-4 rounded-2xl shadow-sm ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none'}`}>
                  <p className="leading-relaxed">{msg.content}</p>
                </div>
              </div>
            )}

            {msg.type === 'lawyers' && (
              <div className="mt-2 ml-10 w-full max-w-2xl space-y-3">
                <p className="text-sm font-medium text-slate-500 uppercase tracking-wider mb-2">
                  Recommended {msg.category} Specialists
                </p>
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
                            <span className="flex items-center gap-1">
                              <Star size={14} className="text-amber-400 fill-amber-400" />
                              {lawyer.rating}
                            </span>
                            <span className="flex items-center gap-1">
                              <Mail size={14} />
                              {lawyer.contact_email}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button className="bg-slate-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors w-full sm:w-auto">
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
              <span className="text-sm text-slate-500">Analyzing legal context...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Form */}
      <footer className="bg-white border-t border-slate-200 p-4">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto relative flex items-center">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={isLoading}
            placeholder="E.g., My landlord is refusing to return my security deposit..."
            className="w-full bg-slate-50 border border-slate-300 rounded-full py-4 pl-6 pr-16 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isLoading || !inputValue.trim()}
            className="absolute right-2 bg-blue-600 text-white p-2.5 rounded-full hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Send size={20} />
          </button>
        </form>
        <p className="text-center text-xs text-slate-400 mt-3">
          This AI assistant routes your inquiry but does not provide official legal advice.
        </p>
      </footer>
    </div>
  );
}