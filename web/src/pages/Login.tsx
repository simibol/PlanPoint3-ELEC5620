import { signInWithPopup } from "firebase/auth";
import { auth, google } from "../firebase";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useState } from "react";
import { signInWithEmail, isValidEmail } from "../utils/auth";

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation() as any;
  const { user } = useAuth();
  const from = loc.state?.from || "/";
  
  // Loading states
  const [googleSigningIn, setGoogleSigningIn] = useState(false);
  const [emailSigningIn, setEmailSigningIn] = useState(false);
  
  // Form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"google" | "email">("google");
  const [error, setError] = useState("");

  // Google sign-in function
  async function signInWithGoogle() {
    setGoogleSigningIn(true);
    setError("");
    try {
      await signInWithPopup(auth, google);
      nav(from, { replace: true });
    } catch (error) {
      console.error("Google sign-in error:", error);
      setError("Failed to sign in with Google. Please try again.");
      setGoogleSigningIn(false);
    }
  }

  // Email/password sign-in function
  async function signInWithEmailPassword(e: React.FormEvent) {
    e.preventDefault();
    setEmailSigningIn(true);
    setError("");

    // Validation
    if (!email || !password) {
      setError("Please enter both email and password.");
      setEmailSigningIn(false);
      return;
    }

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      setEmailSigningIn(false);
      return;
    }

    try {
      const result = await signInWithEmail(email, password);
      if (result.success) {
        nav(from, { replace: true });
      } else {
        setError(result.error || "Failed to sign in.");
        setEmailSigningIn(false);
      }
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError("An unexpected error occurred. Please try again.");
      setEmailSigningIn(false);
    }
  }

  if (user) nav(from, { replace: true });

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem'
    }}>
      {/* Background Pattern */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        opacity: 0.3
      }}></div>

      <div style={{
        background: 'white',
        borderRadius: '24px',
        boxShadow: '0 25px 50px rgba(0,0,0,0.15)',
        padding: '3rem',
        width: '100%',
        maxWidth: '480px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Decorative Elements */}
        <div style={{
          position: 'absolute',
          top: '-100px',
          right: '-100px',
          width: '200px',
          height: '200px',
          background: 'linear-gradient(135deg, #667eea20 0%, #764ba220 100%)',
          borderRadius: '50%',
          zIndex: 0
        }}></div>
        <div style={{
          position: 'absolute',
          bottom: '-80px',
          left: '-80px',
          width: '160px',
          height: '160px',
          background: 'linear-gradient(135deg, #764ba220 0%, #667eea20 100%)',
          borderRadius: '50%',
          zIndex: 0
        }}></div>

        {/* Main Content */}
        <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
          {/* Logo Section */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '2rem'
          }}>
            <div style={{
              width: '80px',
              height: '80px',
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.5rem',
              marginBottom: '1rem',
              boxShadow: '0 10px 30px rgba(79, 70, 229, 0.3)'
            }}>
              🎯
            </div>
          </div>

          {/* Title */}
          <h1 style={{
            margin: '0 0 0.5rem 0',
            fontSize: '2.5rem',
            fontWeight: '700',
            background: 'linear-gradient(135deg, #1f2937 0%, #4f46e5 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.025em'
          }}>
            PlanPoint
          </h1>

          <p style={{
            margin: '0 0 3rem 0',
            fontSize: '1.2rem',
            color: '#6b7280',
            fontWeight: '400',
            lineHeight: '1.6'
          }}>
            Transform your academic schedule into<br />
            <span style={{ color: '#4f46e5', fontWeight: '600' }}>manageable milestones</span>
          </p>

          {/* Features List */}
          <div style={{
            display: 'grid',
            gap: '1rem',
            marginBottom: '3rem',
            textAlign: 'left'
          }}>
            {[
              { icon: '📚', text: 'Import from ICS calendars or CSV files' },
              { icon: '🤖', text: 'AI-powered milestone generation' },
              { icon: '📊', text: 'Track progress and deadlines' }
            ].map((feature, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                padding: '1rem',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px solid #e2e8f0'
              }}>
                <div style={{
                  fontSize: '1.5rem',
                  width: '40px',
                  textAlign: 'center'
                }}>
                  {feature.icon}
                </div>
                <span style={{
                  color: '#374151',
                  fontSize: '1rem',
                  fontWeight: '500'
                }}>
                  {feature.text}
                </span>
              </div>
            ))}
          </div>

          {/* Authentication Mode Toggle */}
          <div style={{
            display: 'flex',
            background: '#f8fafc',
            borderRadius: '12px',
            padding: '4px',
            marginBottom: '2rem',
            border: '1px solid #e2e8f0'
          }}>
            <button
              onClick={() => setAuthMode("google")}
              style={{
                flex: 1,
                padding: '0.75rem',
                border: 'none',
                borderRadius: '8px',
                background: authMode === "google" ? 'white' : 'transparent',
                color: authMode === "google" ? '#374151' : '#6b7280',
                fontWeight: authMode === "google" ? '600' : '500',
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: authMode === "google" ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              🚀 Quick Sign-in
            </button>
            <button
              onClick={() => setAuthMode("email")}
              style={{
                flex: 1,
                padding: '0.75rem',
                border: 'none',
                borderRadius: '8px',
                background: authMode === "email" ? 'white' : 'transparent',
                color: authMode === "email" ? '#374151' : '#6b7280',
                fontWeight: authMode === "email" ? '600' : '500',
                fontSize: '0.9rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: authMode === "email" ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
              }}
            >
              📧 Email & Password
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#dc2626',
              padding: '0.75rem',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              fontSize: '0.9rem',
              textAlign: 'center'
            }}>
              {error}
            </div>
          )}

          {/* Google Sign-in */}
          {authMode === "google" && (
            <>
              <button
                onClick={signInWithGoogle}
                disabled={googleSigningIn}
                style={{
                  width: '100%',
                  background: googleSigningIn ? '#f3f4f6' : 'white',
                  border: googleSigningIn ? '2px solid #e5e7eb' : '2px solid #4285f4',
                  borderRadius: '12px',
                  padding: '1rem 2rem',
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  cursor: googleSigningIn ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.75rem',
                  boxShadow: googleSigningIn ? 'none' : '0 4px 12px rgba(66, 133, 244, 0.2)',
                  color: googleSigningIn ? '#9ca3af' : '#4285f4',
                  marginBottom: '1.5rem'
                }}
              >
                {googleSigningIn ? (
                  <>
                    <div style={{
                      width: '20px',
                      height: '20px',
                      border: '2px solid #e5e7eb',
                      borderTop: '2px solid #9ca3af',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }}></div>
                    Signing you in...
                  </>
                ) : (
                  <>
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Continue with Google
                  </>
                )}
              </button>
              
              <p style={{
                textAlign: 'center',
                fontSize: '0.9rem',
                color: '#6b7280',
                margin: '0'
              }}>
                New to PlanPoint?{' '}
                <Link
                  to="/signup"
                  style={{
                    color: '#4f46e5',
                    textDecoration: 'none',
                    fontWeight: '600'
                  }}
                >
                  Create an account
                </Link>
              </p>
            </>
          )}

          {/* Email/Password Sign-in */}
          {authMode === "email" && (
            <>
              <form onSubmit={signInWithEmailPassword} style={{ textAlign: 'left' }}>
                {/* Email Field */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    color: '#374151',
                    marginBottom: '0.5rem'
                  }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      transition: 'border-color 0.2s ease',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#4f46e5'}
                    onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
                  />
                </div>

                {/* Password Field */}
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    color: '#374151',
                    marginBottom: '0.5rem'
                  }}>
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      border: '2px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      transition: 'border-color 0.2s ease',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#4f46e5'}
                    onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={emailSigningIn}
                  style={{
                    width: '100%',
                    background: emailSigningIn ? '#f3f4f6' : 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                    color: emailSigningIn ? '#9ca3af' : 'white',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '1rem 2rem',
                    fontSize: '1.1rem',
                    fontWeight: '600',
                    cursor: emailSigningIn ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.75rem',
                    boxShadow: emailSigningIn ? 'none' : '0 4px 12px rgba(79, 70, 229, 0.3)',
                    marginBottom: '1.5rem'
                  }}
                >
                  {emailSigningIn ? (
                    <>
                      <div style={{
                        width: '20px',
                        height: '20px',
                        border: '2px solid #e5e7eb',
                        borderTop: '2px solid #9ca3af',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                      }}></div>
                      Signing In...
                    </>
                  ) : (
                    'Sign In'
                  )}
                </button>
              </form>

              <div style={{ textAlign: 'center' }}>
                <p style={{
                  fontSize: '0.9rem',
                  color: '#6b7280',
                  margin: '0 0 1rem 0'
                }}>
                  New to PlanPoint?{' '}
                  <Link
                    to="/signup"
                    style={{
                      color: '#4f46e5',
                      textDecoration: 'none',
                      fontWeight: '600'
                    }}
                  >
                    Create an account
                  </Link>
                </p>
                
                <button
                  type="button"
                  onClick={() => {
                    if (email) {
                      // TODO: Implement password reset functionality
                      alert('Password reset functionality will be implemented soon!');
                    } else {
                      alert('Please enter your email address first.');
                    }
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#6b7280',
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    textDecoration: 'underline'
                  }}
                >
                  Forgot your password?
                </button>
              </div>
            </>
          )}

          {/* Footer */}
          <p style={{
            marginTop: '2rem',
            fontSize: '0.9rem',
            color: '#9ca3af',
            lineHeight: '1.5',
            textAlign: 'center'
          }}>
            By signing in, you agree to our terms of service.<br />
            Your academic data is stored securely and privately.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 6px 20px rgba(66, 133, 244, 0.3) !important;
        }
        
        button:active:not(:disabled) {
          transform: translateY(0);
        }
        
        @media (max-width: 640px) {
          .login-container {
            padding: 2rem 1.5rem !important;
            margin: 1rem !important;
          }
          
          .login-title {
            font-size: 2rem !important;
          }
          
          .login-subtitle {
            font-size: 1rem !important;
          }
        }
      `}</style>
    </div>
  );
}
