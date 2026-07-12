// --- Configuration ---
const SUPABASE_URL = 'https://kynqldakmqdrvtkptgkc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kV-S7uk5f0px-PrqTkq-VA_vzrAEB60';
const FEATHERLESS_API_KEY = 'rc_5740afef345ddd13cf013741e33ed21ebf106bc3c850d3e32a11dca127b53a0e';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener("DOMContentLoaded", async () => {
    
    // 1. Session check
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'register.html';
        return;
    }
    const user = session.user;
    const userId = user.id;

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });

    const generateBtn = document.getElementById('generate-schedule-btn');
    const aiLoading = document.getElementById('ai-loading');

    // --- 2. Check Google Classroom Connection UI ---
    const isGoogleConnected = user.app_metadata.provider === 'google' || 
        (user.identities && user.identities.some(id => id.provider === 'google'));

    if (!isGoogleConnected) {
        const mainContent = document.querySelector('.dashboard-content');
        const header = document.querySelector('.dashboard-header');
        const noticeBox = document.createElement('div');
        noticeBox.className = 'brutal-alert';
        noticeBox.style.justifyContent = 'space-between';
        noticeBox.style.backgroundColor = 'var(--accent-yellow)';
        noticeBox.style.marginBottom = '2rem';
        
        noticeBox.innerHTML = `
            <div>
                <strong>Google Classroom isn't connected.</strong>
                <p style="margin-bottom: 0; font-size: 0.9rem;">Connect your account to automatically pull in deadlines and test dates.</p>
            </div>
            <button id="connect-classroom-btn" class="btn btn-secondary" style="background-color: var(--bg-color);">Connect</button>
        `;
        mainContent.insertBefore(noticeBox, header.nextSibling);

        document.getElementById('connect-classroom-btn').addEventListener('click', async () => {
            await supabaseClient.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    scopes: 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'consent'
                    },
                    redirectTo: `${window.location.origin}/s-dashboard.html`
                }
            });
    });

    // Helpers to render the calendar grid
    const renderEvent = (day, time, title, type) => {
        const column = document.getElementById(`col-${day.toLowerCase()}`);
        if (column) {
            const block = document.createElement('div');
            block.className = `event-block type-${type}`;
            block.innerHTML = `<div class="event-time">${time}</div><div class="event-title">${title}</div>`;
            column.appendChild(block);
        }
    };

    const clearCalendar = () => {
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].forEach(day => {
            const col = document.getElementById(`col-${day}`);
            if (col) col.innerHTML = '';
        });
    };

    // --- 3. Fetch Real Deadlines & Render to Grid ---
    const fetchUserAssignments = async () => {
        const { data: assignments } = await supabaseClient.from('assignments').select('*').eq('user_id', userId);
        return assignments || [];
    };

    const loadCalendar = async () => {
        clearCalendar();
        const userDeadlines = await fetchUserAssignments();
        userDeadlines.forEach(item => {
            renderEvent(item.due_day || 'monday', item.due_time || '11:59 PM (Due)', item.title, 'deadline');
        });
    };
    
    // Load it on page start!
    await loadCalendar();

    // --- 4. Generate Schedule via DeepSeek AI ---
    generateBtn.addEventListener('click', async () => {
        const activeDeadlines = await fetchUserAssignments();
        if (activeDeadlines.length === 0) {
            alert('No upcoming assignments found! Connect Google Classroom first.');
            return;
        }

        generateBtn.disabled = true;
        aiLoading.classList.remove('hidden');

        const systemPrompt = `You are an AI scheduler. Create a study schedule for a 5-day week (Monday to Friday). 
        Deadlines: ${JSON.stringify(activeDeadlines)}.
        Allocate study blocks prior to these deadlines. 
        Output strictly a JSON array of objects with keys: "day" (e.g. "monday"), "time" (e.g. "4:00 PM"), "title" (e.g. "Study..."), "type" (must be "study"). No markdown.`;

        try {
            const response = await fetch("https://api.featherless.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${FEATHERLESS_API_KEY}`
                },
                body: JSON.stringify({
                    model: "Qwen/Qwen2.5-Coder-32B-Instruct", // Replaced with valid Featherless Model ID
                    messages: [{ role: "user", content: systemPrompt }],
                    temperature: 0.2
                })
            });

            const data = await response.json();
            const content = data.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiSchedule = JSON.parse(content);

            await loadCalendar(); // Reload hard deadlines
            
            aiSchedule.forEach(block => {
                renderEvent(block.day, block.time, block.title, block.type);
            });

        } catch (error) {
            alert("AI Failed: " + error.message);
        } finally {
            generateBtn.disabled = false;
            aiLoading.classList.add('hidden');
        }
    });
});
