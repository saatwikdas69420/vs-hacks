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

    // 2. Logout setup
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });

    const generateBtn = document.getElementById('generate-schedule-btn');
    const aiLoading = document.getElementById('ai-loading');

    // --- 3. Check Google Classroom Connection ---
    const isGoogleConnected = user.app_metadata.provider === 'google' || 
        (user.identities && user.identities.some(id => id.provider === 'google'));

    if (!isGoogleConnected) {
        // Create and insert a Google Classroom Notice Box above the calendar
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
            <button id="connect-classroom-btn" class="btn btn-secondary" style="background-color: var(--bg-color); white-space: nowrap;">
                Connect Google Classroom
            </button>
        `;

        mainContent.insertBefore(noticeBox, header.nextSibling);

        // Handle direct linking when button is clicked
        document.getElementById('connect-classroom-btn').addEventListener('click', async () => {
            try {
                const { error } = await supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        scopes: 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly',
                        redirectTo: `${window.location.origin}/s-dashboard.html`
                    }
                });
                if (error) throw error;
            } catch (err) {
                alert('Could not connect to Google: ' + err.message);
            }
        });
    }

    // Helper to render event blocks onto the calendar grid
    const renderEvent = (day, time, title, type) => {
        const colId = `col-${day.toLowerCase()}`;
        const column = document.getElementById(colId);
        
        if (column) {
            const block = document.createElement('div');
            block.className = `event-block type-${type}`;
            block.innerHTML = `
                <div class="event-time">${time}</div>
                <div class="event-title">${title}</div>
            `;
            column.appendChild(block);
        }
    };

    // Helper to clear dynamically rendered events (preserving layout)
    const clearCalendar = () => {
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
        days.forEach(day => {
            const col = document.getElementById(`col-${day}`);
            if (col) col.innerHTML = '';
        });
    };

    // 4. Fetch Real Deadlines & Assignments from Supabase
    const fetchUserAssignments = async () => {
        try {
            const { data: assignments, error } = await supabaseClient
                .from('assignments')
                .select('*')
                .eq('user_id', userId);

            if (error) throw error;
            return assignments || [];
        } catch (err) {
            console.error('Error fetching assignments:', err.message);
            return [];
        }
    };

    // Populate actual user deadlines directly onto the grid
    const userDeadlines = await fetchUserAssignments();

    if (userDeadlines.length > 0) {
        userDeadlines.forEach(item => {
            const day = item.due_day || 'monday';
            const time = item.due_time || '11:59 PM (Due)';
            renderEvent(day, time, item.title, 'deadline');
        });
    }

    // 5. Generate Schedule via Featherless / DeepSeek AI
    generateBtn.addEventListener('click', async () => {
        const activeDeadlines = await fetchUserAssignments();

        if (activeDeadlines.length === 0) {
            alert('No upcoming assignments or tests found in your database. Connect Google Classroom or sync some deadlines first!');
            return;
        }

        generateBtn.disabled = true;
        aiLoading.classList.remove('hidden');

        const deadlineSummary = activeDeadlines.map(d => ({
            task: d.title,
            due_day: d.due_day,
            type: d.type || "deadline"
        }));

        const systemPrompt = `You are a student scheduling AI. Create an optimized study schedule for a 5-day week (Monday to Friday). 
The student has these real upcoming deadlines and exams: ${JSON.stringify(deadlineSummary)}.
Allocate 1-2 hour focused study blocks prior to these deadlines. 
Output ONLY a raw JSON array of objects with the exact keys: "day" (e.g. "Monday"), "time" (e.g. "4:00 PM"), "title" (e.g. "Study for AP Physics"), "type" (must be exactly "study"). Do not include any markdown formatting or commentary.`;

        try {
            const response = await fetch("https://api.featherless.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${FEATHERLESS_API_KEY}`
                },
                body: JSON.stringify({
                    model: "deepseek-coder-v2-instruct",
                    messages: [
                        { role: "system", content: systemPrompt }
                    ],
                    temperature: 0.2
                })
            });

            if (!response.ok) {
                throw new Error(`AI API error: ${response.statusText}`);
            }

            const data = await response.json();
            
            let aiSchedule;
            try {
                const content = data.choices[0].message.content.trim();
                const cleanedContent = content.replace(/```json/g, '').replace(/```/g, '');
                aiSchedule = JSON.parse(cleanedContent);
            } catch (e) {
                throw new Error("AI returned unparseable schedule output. Please try again.");
            }

            // Clear previous study blocks and re-render deadlines + AI schedule
            clearCalendar();
            activeDeadlines.forEach(item => {
                renderEvent(item.due_day || 'monday', item.due_time || '11:59 PM (Due)', item.title, 'deadline');
            });

            // Render new AI study blocks
            aiSchedule.forEach(block => {
                renderEvent(block.day, block.time, block.title, block.type);
            });

        } catch (error) {
            console.error("AI Generation Error:", error);
            alert("Failed to generate schedule: " + error.message);
        } finally {
            generateBtn.disabled = false;
            aiLoading.classList.add('hidden');
        }
    });
});

// Function to sync assignments directly from Google Classroom API
async function syncGoogleClassroomAssignments(session) {
    const providerToken = session.provider_token; // Google OAuth Access Token
    if (!providerToken) return;

    try {
        // 1. Fetch user's Google Classroom courses
        const coursesRes = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE', {
            headers: { Authorization: `Bearer ${providerToken}` }
        });
        const coursesData = await coursesRes.json();
        if (!coursesData.courses) return;

        // 2. Fetch coursework (assignments) for each course
        for (const course of coursesData.courses) {
            const workRes = await fetch(`https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`, {
                headers: { Authorization: `Bearer ${providerToken}` }
            });
            const workData = await workRes.json();

            if (workData.courseWork) {
                for (const work of workData.courseWork) {
                    // Map Google due date to weekday string (e.g. "monday")
                    let dueDay = 'monday';
                    if (work.dueDate) {
                        const dateObj = new Date(work.dueDate.year, work.dueDate.month - 1, work.dueDate.day);
                        dueDay = dateObj.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                    }

                    // Upsert assignment into Supabase DB
                    await supabaseClient.from('assignments').upsert([{
                        user_id: session.user.id,
                        title: `${course.name}: ${work.title}`,
                        due_day: dueDay,
                        due_time: work.dueTime ? `${work.dueTime.hours}:${work.dueTime.minutes || '00'}` : '11:59 PM (Due)',
                        type: 'deadline'
                    }], { onConflict: 'title' });
                }
            }
        }
        console.log("Google Classroom sync complete!");
    } catch (err) {
        console.error("Failed to sync Google Classroom:", err);
    }
}
