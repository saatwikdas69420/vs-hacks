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

    // Logout Handler
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        localStorage.removeItem('google_provider_token');
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
    }

    // --- 3. Calendar Grid Rendering Helpers ---
    const renderEvent = (day, time, title, type) => {
        if (!day) return;
        const cleanDay = day.toLowerCase().trim();
        const column = document.getElementById(`col-${cleanDay}`);
        
        if (column) {
            const block = document.createElement('div');
            block.className = `event-block type-${type}`;
            block.style.cssText = `
                background-color: ${type === 'deadline' ? '#ff7676' : '#a3e635'};
                border: 2px solid #000;
                padding: 0.5rem;
                margin-top: 0.5rem;
                font-weight: bold;
                border-radius: 4px;
            `;
            block.innerHTML = `
                <div class="event-time" style="font-size: 0.8rem; opacity: 0.8;">${time}</div>
                <div class="event-title" style="font-size: 0.9rem; margin-top: 0.2rem;">${title}</div>
            `;
            column.appendChild(block);
        }
    };

    const clearCalendar = () => {
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].forEach(day => {
            const col = document.getElementById(`col-${day}`);
            if (col) col.innerHTML = '';
        });
    };

    // --- 4. Fetch Deadlines & Load into Calendar ---
    const fetchUserAssignments = async () => {
        const { data: assignments, error } = await supabaseClient
            .from('assignments')
            .select('*')
            .eq('user_id', userId);

        if (error) {
            console.error("Error fetching assignments:", error);
            return [];
        }
        return assignments || [];
    };

    const loadCalendar = async () => {
        clearCalendar();
        const userDeadlines = await fetchUserAssignments();

        if (userDeadlines.length === 0) {
            console.warn("No deadlines found in database for schedule grid.");
            return;
        }

        userDeadlines.forEach(item => {
            renderEvent(
                item.due_day || 'monday', 
                item.due_time || '11:59 PM', 
                item.title, 
                'deadline'
            );
        });
    };
    
    // Load existing assignments directly into grid on page start
    await loadCalendar();

    // --- 5. Generate AI Schedule via Featherless AI ---
    generateBtn.addEventListener('click', async () => {
        const activeDeadlines = await fetchUserAssignments();
        if (activeDeadlines.length === 0) {
            alert('No upcoming assignments found! Connect Google Classroom or sync assignments first.');
            return;
        }

        generateBtn.disabled = true;
        aiLoading.classList.remove('hidden');

        const systemPrompt = `You are an AI scheduler. Create a study schedule for a 5-day week (monday, tuesday, wednesday, thursday, friday). 
Deadlines: ${JSON.stringify(activeDeadlines)}.
Allocate study blocks prior to these deadlines. 
Output ONLY plain text key-value blocks in this exact format for each session:

DAY: monday
TIME: 4:00 PM
TITLE: Study Physics
TYPE: study

Do not use JSON, backticks, or markdown formatting. Just repeat the block for each study session.`;

        try {
            const response = await fetch("https://api.featherless.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${FEATHERLESS_API_KEY}`
                },
                body: JSON.stringify({
                    model: "Qwen/Qwen2.5-Coder-32B-Instruct",
                    messages: [{ role: "user", content: systemPrompt }],
                    temperature: 0.1
                })
            });

            const data = await response.json();
            const rawText = data.choices[0].message.content;

            // Clear & reload deadlines
            await loadCalendar();

            // Regex parsing for plain text output
            const blocks = rawText.split(/\n\s*\n/);
            blocks.forEach(block => {
                const dayMatch = block.match(/DAY:\s*(.*)/i);
                const timeMatch = block.match(/TIME:\s*(.*)/i);
                const titleMatch = block.match(/TITLE:\s*(.*)/i);

                if (dayMatch && timeMatch && titleMatch) {
                    renderEvent(
                        dayMatch[1].trim(), 
                        timeMatch[1].trim(), 
                        titleMatch[1].trim(), 
                        'study'
                    );
                }
            });

        } catch (error) {
            alert("AI Schedule Generation Failed: " + error.message);
            console.error("AI Schedule Error:", error);
        } finally {
            generateBtn.disabled = false;
            aiLoading.classList.add('hidden');
        }
    });
});
