const SUPABASE_URL = 'https://kynqldakmqdrvtkptgkc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kV-S7uk5f0px-PrqTkq-VA_vzrAEB60';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener("DOMContentLoaded", async () => {
    
    // 1. Session check - bounce logged in users to dashboard
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        window.location.href = 'm-dashboard.html';
        return;
    }

    // State variable
    let isSignUp = true;

    // DOM Elements
    const authForm = document.getElementById('auth-form');
    const alertBox = document.getElementById('alert-box');
    const googleAuthBtn = document.getElementById('google-auth-btn');
    
    // Toggle Elements
    const authToggleContainer = document.getElementById('auth-toggle-container');
    const btnSignup = document.getElementById('btn-signup');
    const btnLogin = document.getElementById('btn-login');

    // Text Elements to Animate
    const authBadge = document.getElementById('auth-badge');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');
    const submitBtn = document.getElementById('submit-btn');
    const textElements = [authBadge, authTitle, authSubtitle, submitBtn];

    const showAlert = (message, type) => {
        alertBox.textContent = message;
        alertBox.className = `alert ${type}`;
    };

    // 2. Animate and Update Text Helper
    const updateAuthUI = (toSignUp) => {
        if (isSignUp === toSignUp) return; // Don't run if clicking the active state
        isSignUp = toSignUp;
        alertBox.classList.add('hidden');

        // Toggle the slider CSS class
        if (isSignUp) {
            authToggleContainer.classList.remove('login-mode');
        } else {
            authToggleContainer.classList.add('login-mode');
        }

        // Slide text down & fade out
        textElements.forEach(el => el.classList.add('text-hidden'));

        // Wait for fade out, change text, then slide up & fade in
        setTimeout(() => {
            if (isSignUp) {
                authBadge.textContent = 'Start Automating';
                authTitle.textContent = 'Create your account';
                authSubtitle.textContent = 'Connect your classroom and streamline your workflow today.';
                submitBtn.textContent = 'Sign Up';
            } else {
                authBadge.textContent = 'Welcome Back';
                authTitle.textContent = 'Log into StudySync';
                authSubtitle.textContent = 'Enter your credentials to access your workspace.';
                submitBtn.textContent = 'Log In';
            }
            // Trigger fade back in
            textElements.forEach(el => el.classList.remove('text-hidden'));
        }, 250); // matches CSS transition timing
    };

    // Toggle Button Listeners
    btnSignup.addEventListener('click', () => updateAuthUI(true));
    btnLogin.addEventListener('click', () => updateAuthUI(false));

    // 3. Handle Form Submission
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        submitBtn.textContent = isSignUp ? 'Registering...' : 'Logging in...';
        submitBtn.disabled = true;
        alertBox.classList.add('hidden');

        try {
            let result;

            if (isSignUp) {
                result = await supabaseClient.auth.signUp({ email, password });
            } else {
                result = await supabaseClient.auth.signInWithPassword({ email, password });
            }

            if (result.error) throw result.error;

            showAlert(isSignUp ? 'Registration successful! Redirecting...' : 'Login successful! Redirecting...', 'success');
            
            setTimeout(() => {
                window.location.href = 'm-dashboard.html';
            }, 1000);

        } catch (error) {
            showAlert(error.message, 'error');
            submitBtn.textContent = isSignUp ? 'Sign Up' : 'Log In';
            submitBtn.disabled = false;
        }
    });

    // 4. Handle Google OAuth Flow
    googleAuthBtn.addEventListener('click', async () => {
        try {
            const { error } = await supabaseClient.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    scopes: 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly',
                    redirectTo: `${window.location.origin}/m-dashboard.html`
                }
            });

            if (error) throw error;
        } catch (error) {
            showAlert('Failed to connect to Google: ' + error.message, 'error');
        }
    });
});
