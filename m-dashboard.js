const SUPABASE_URL = 'https://kynqldakmqdrvtkptgkc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kV-S7uk5f0px-PrqTkq-VA_vzrAEB60';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

document.addEventListener("DOMContentLoaded", async () => {
    
    // --- 1. Authentication Check ---
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        window.location.href = 'register.html';
        return;
    }
    const user = session.user;
    document.getElementById('user-greeting').textContent = `Welcome back, ${user.email.split('@')[0]}.`;

    // --- 2. Google Classroom Sync Function ---
    async function syncGoogleClassroomAssignments() {
        const providerToken = session.provider_token; 
        if (!providerToken) return;

        try {
            const coursesRes = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE', {
                headers: { Authorization: `Bearer ${providerToken}` }
            });
            const coursesData = await coursesRes.json();
            if (!coursesData.courses) return;

            // CLEAR old assignments to avoid duplicates and bypass constraint errors
            await supabaseClient.from('assignments').delete().eq('user_id', user.id);

            for (const course of coursesData.courses) {
                const workRes = await fetch(`https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`, {
                    headers: { Authorization: `Bearer ${providerToken}` }
                });
                const workData = await workRes.json();

                if (workData.courseWork) {
                    for (const work of workData.courseWork) {
                        let dueDay = 'monday';
                        if (work.dueDate) {
                            const dateObj = new Date(work.dueDate.year, work.dueDate.month - 1, work.dueDate.day);
                            dueDay = dateObj.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                        }
                        // INSERT fresh assignments
                        await supabaseClient.from('assignments').insert([{
                            user_id: user.id,
                            title: `${course.name}: ${work.title}`,
                            due_day: dueDay,
                            due_time: '11:59 PM',
                            type: 'deadline'
                        }]);
                    }
                }
            }
        } catch (err) {
            console.error("Failed to sync Google Classroom:", err);
        }
    }

    // Trigger sync if we just logged in via Google
    if (session.provider_token) {
        await syncGoogleClassroomAssignments();
    }

    // --- 3. Render Assignments to the UI Widget ---
    const assignmentsListEl = document.getElementById('assignments-list');
    const assignmentCountEl = document.getElementById('assignment-count');
    
    const isGoogleConnected = user.app_metadata.provider === 'google' || 
        (user.identities && user.identities.some(id => id.provider === 'google'));

    if (!isGoogleConnected) {
        assignmentCountEl.textContent = '!';
        assignmentsListEl.innerHTML = `
            <li class="connect-classroom-box">
                <p>Google Classroom is not linked.</p>
                <button id="connect-classroom-btn" class="btn btn-secondary btn-full">Connect Google Classroom</button>
            </li>
        `;
        document.getElementById('connect-classroom-btn').addEventListener('click', async () => {
            await supabaseClient.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    scopes: 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly',
                    redirectTo: `${window.location.origin}/m-dashboard.html`
                }
            });
        });
    } else {
        // Fetch from Supabase and render
        const { data: assignments } = await supabaseClient.from('assignments').select('*').eq('user_id', user.id);
        
        if (!assignments || assignments.length === 0) {
            assignmentCountEl.textContent = '0';
            assignmentsListEl.innerHTML = `<li class="task-item" style="opacity: 0.7;">No upcoming assignments found</li>`;
        } else {
            assignmentCountEl.textContent = assignments.length;
            assignmentsListEl.innerHTML = ''; // clear loading state
            
            assignments.forEach(task => {
                const li = document.createElement('li');
                li.className = 'task-item';
                li.innerHTML = `
                    <span class="task-name">${task.title}</span>
                    <span class="task-due">${task.due_day.charAt(0).toUpperCase() + task.due_day.slice(1)}</span>
                `;
                assignmentsListEl.appendChild(li);
            });
        }
    }

    // --- 4. Realtime Peer Activity & Logout ---
    const activityFeedEl = document.getElementById('activity-feed');
    activityFeedEl.innerHTML = '<li class="activity-item empty-state" style="opacity: 0.6;">No recent peer activity</li>';

    supabaseClient.channel('public:peer_activity')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'peer_activity' }, (payload) => {
            const empty = activityFeedEl.querySelector('.empty-state');
            if (empty) empty.remove();
            
            const li = document.createElement('li');
            li.className = 'activity-item';
            li.innerHTML = `<span class="task-name">${payload.new.action_message}</span><span class="task-due">Just now</span>`;
            li.style.backgroundColor = 'var(--accent-yellow)';
            
            activityFeedEl.prepend(li);
            setTimeout(() => { li.style.backgroundColor = '#f8f8f8'; }, 1000);
            if(activityFeedEl.children.length > 4) activityFeedEl.lastChild.remove();
        }).subscribe();

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });
});
