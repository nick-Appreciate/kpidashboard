'use client';

import { useEffect, useRef, useState } from 'react';

export default function JustCallDialer({ onReady, onCallStart, onCallEnd }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const dialerRef = useRef(null);
  const justcallInstance = useRef(null);

  useEffect(() => {
    // Dynamically import the SDK (client-side only)
    const initDialer = async () => {
      try {
        // Wait for the container element to be in the DOM
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const container = document.getElementById('justcall-dialer-container');
        if (!container) {
          console.error('JustCall container not found');
          return;
        }
        
        const { JustCallDialer } = await import('@justcall/justcall-dialer-sdk');
        
        justcallInstance.current = new JustCallDialer({
          dialerId: 'justcall-dialer-container',
          onLogin: () => {
            console.log('JustCall: User logged in');
            setIsReady(true);
            onReady?.();
          },
          onLogout: () => {
            console.log('JustCall: User logged out');
            setIsReady(false);
          },
          onReady: () => {
            console.log('JustCall: Dialer ready');
            setIsReady(true);
            onReady?.();
          },
          onCallRinging: (data) => {
            console.log('JustCall: Call ringing', data);
            onCallStart?.(data);
          },
          onCallAnswered: (data) => {
            console.log('JustCall: Call answered', data);
          },
          onCallEnded: (data) => {
            console.log('JustCall: Call ended', data);
            onCallEnd?.(data);
          }
        });
      } catch (error) {
        console.error('Failed to initialize JustCall dialer:', error);
      }
    };

    if (isOpen) {
      initDialer();
    }

    return () => {
      if (justcallInstance.current) {
        justcallInstance.current.destroy();
        justcallInstance.current = null;
      }
    };
  }, [isOpen]);

  const makeCall = (phoneNumber, contactName) => {
    if (!justcallInstance.current || !isReady) {
      console.warn('JustCall dialer not ready');
      return false;
    }
    
    try {
      justcallInstance.current.dialNumber(phoneNumber);
      return true;
    } catch (error) {
      console.error('Failed to make call:', error);
      return false;
    }
  };

  // Expose makeCall function
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.justcallMakeCall = makeCall;
      window.justcallOpen = () => setIsOpen(true);
      window.justcallIsReady = () => isReady;
    }
  }, [isReady]);

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-4 right-4 z-50 p-4 rounded-full shadow-lg transition-all ${
          isOpen 
            ? 'bg-red-500 hover:bg-red-600' 
            : 'bg-green-500 hover:bg-green-600'
        } text-white`}
        title={isOpen ? 'Close Dialer' : 'Open Dialer'}
      >
        {isOpen ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
          </svg>
        )}
      </button>

      {/* Dialer panel */}
      {isOpen && (
        <div className="fixed bottom-20 right-4 z-40 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden">
          <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between">
            <span className="font-medium">JustCall Dialer</span>
            <div className="flex items-center gap-3">
              {isReady ? (
                <span className="text-xs bg-green-500 px-2 py-0.5 rounded-full">Ready</span>
              ) : (
                <span className="text-xs bg-yellow-500 px-2 py-0.5 rounded-full">Connecting...</span>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-slate-700 rounded transition-colors"
                title="Close dialer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
          <div 
            id="justcall-dialer-container" 
            ref={dialerRef}
            style={{ width: '385px', height: '600px' }}
          />
        </div>
      )}
    </>
  );
}

// Helper hook for using JustCall in other components
export function useJustCall() {
  const makeCall = (phoneNumber, contactName) => {
    if (typeof window !== 'undefined' && window.justcallMakeCall) {
      // Open dialer if not already open
      if (!window.justcallIsReady?.()) {
        window.justcallOpen?.();
        // Wait a bit for dialer to initialize, then try to call
        setTimeout(() => {
          window.justcallMakeCall?.(phoneNumber, contactName);
        }, 2000);
      } else {
        return window.justcallMakeCall(phoneNumber, contactName);
      }
    }
    return false;
  };

  const openDialer = () => {
    if (typeof window !== 'undefined' && window.justcallOpen) {
      window.justcallOpen();
    }
  };

  return { makeCall, openDialer };
}
