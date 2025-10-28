import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail,
  updateProfile,
  AuthError
} from "firebase/auth";
import { auth } from "../firebase";

export interface AuthResult {
  success: boolean;
  user?: any;
  error?: string;
}

/**
 * Sign up a new user with email and password
 */
export async function signUpWithEmail(
  email: string, 
  password: string, 
  displayName?: string
): Promise<AuthResult> {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    
    // Set display name if provided
    if (displayName && result.user) {
      await updateProfile(result.user, { displayName });
    }
    
    return {
      success: true,
      user: result.user
    };
  } catch (error) {
    return {
      success: false,
      error: getAuthErrorMessage(error as AuthError)
    };
  }
}

/**
 * Sign in existing user with email and password
 */
export async function signInWithEmail(
  email: string, 
  password: string
): Promise<AuthResult> {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return {
      success: true,
      user: result.user
    };
  } catch (error) {
    return {
      success: false,
      error: getAuthErrorMessage(error as AuthError)
    };
  }
}

/**
 * Send password reset email
 */
export async function resetPassword(email: string): Promise<AuthResult> {
  try {
    await sendPasswordResetEmail(auth, email);
    return {
      success: true
    };
  } catch (error) {
    return {
      success: false,
      error: getAuthErrorMessage(error as AuthError)
    };
  }
}

/**
 * Convert Firebase auth errors to user-friendly messages
 */
function getAuthErrorMessage(error: AuthError): string {
  switch (error.code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters long.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-not-found':
      return 'No account found with this email address.';
    case 'auth/wrong-password':
      return 'Incorrect password. Please try again.';
    case 'auth/invalid-credential':
      return 'Invalid email or password. Please check and try again.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection and try again.';
    default:
      return error.message || 'An error occurred during authentication.';
  }
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (password.length < 6) {
    errors.push('Password must be at least 6 characters long');
  }
  
  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }
  
  if (!/[a-zA-Z]/.test(password)) {
    errors.push('Password must contain at least one letter');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
