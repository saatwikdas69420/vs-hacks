const SUPABASE_URL = 'https://kynqldakmqdrvtkptgkc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kV-S7uk5f0px-PrqTkq-VA_vzrAEB60';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener("DOMContentLoaded", () => {
    const registerForm = document.getElementById('register-form');
    const alertBox = document.getElementById('alert-box');
    const submitBtn = document.getElementById('submit-btn');
    const googleAuthBtn = document.getElementById('google-auth-btn');

    // Utility to show alert messages in a brutalist box
    const showAlert = (message, type) => {
        alertBox.textContent = message;
        alertBox.className = `alert ${type}`;
    };

    // Handle standard Email/Password Registration
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        submitBtn.textContent = 'Registering...';
        submitBtn.disabled = true;
        alertBox.classList.add('hidden');

        try {
            // Using updated supabaseClient instance
            const { data, error } = await supabaseClient.auth.signUp({
                email: email,
                password: password,
            });

            if (error) throw error;

            showAlert('Registration successful! Redirecting...', 'success');
            
            setTimeout(() => {
                window.location.href = 'm-dashboard.html';
            }, 1500);

        } catch (error) {
            showAlert(error.message, 'error');
            submitBtn.textContent = 'Sign Up';
            submitBtn.disabled = false;
        }
    });

    // Handle Google Classroom (OAuth) Connection
    googleAuthBtn.addEventListener('click', async () => {
        try {
            // Using updated supabaseClient instance
            const { data, error } = await supabaseClient.auth.signInWithOAuth({
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
