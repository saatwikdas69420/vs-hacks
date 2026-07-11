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

    // Update greeting
    const greetingEl = document.getElementById('user-greeting');
    const userEmail = user.email;
    const username = userEmail.split('@')[0];
    greetingEl.textContent = `Welcome back, ${username}.`;


    // --- 2. Check Google Classroom Connection ---
    const assignmentsListEl = document.getElementById('assignments-list');
    const assignmentCountEl = document.getElementById('assignment-count');

    // Check if the user's account has a Google Identity linked
    const isGoogleConnected = user.app_metadata.provider === 'google' || 
        (user.identities && user.identities.some(id => id.provider === 'google'));

    if (!isGoogleConnected) {
        // Render "Connect to Google Classroom" state inside the widget
        assignmentCountEl.textContent = '!';
        assignmentsListEl.innerHTML = `
            <li class="connect-classroom-box">
                <p>Google Classroom is not linked to this account.</p>
                <button id="connect-classroom-btn" class="btn btn-secondary btn-full" style="margin-top: 0.5rem; background-color: var(--bg-color);">
                    Connect Google Classroom
                </button>
            </li>
        `;

        // Handle direct linking when clicked
        document.getElementById('connect-classroom-btn').addEventListener('click', async () => {
            try {
                const { error } = await supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        scopes: 'https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.coursework.me.readonly',
                        redirectTo: `${window.location.origin}/m-dashboard.html`
                    }
                });
                if (error) throw error;
            } catch (err) {
                alert('Could not connect to Google: ' + err.message);
            }
        });

    } else {
        // User IS connected to Google Classroom
        // If there are no assignments fetched yet from Supabase tables:
        assignmentCountEl.textContent = '0';
        assignmentsListEl.innerHTML = `
            <li class="task-item" style="justify-content: center; opacity: 0.7;">
                No upcoming assignments found
            </li>
        `;

    }

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

    // --- 3. Realtime Activity Feed Setup ---
    const activityFeedEl = document.getElementById('activity-feed');
    activityFeedEl.innerHTML = '';

    const renderEmptyState = () => {
        activityFeedEl.innerHTML = `
            <li class="activity-item empty-state" style="justify-content: center; opacity: 0.6;">
                No recent peer activity
            </li>
        `;
    };

    renderEmptyState();

    const renderActivity = (message) => {
        const li = document.createElement('li');
        li.className = 'activity-item';
        li.innerHTML = `
            <span class="task-name">${message}</span>
            <span class="task-due">Just now</span>
        `;
        return li;
    };

    // Setup Supabase Realtime Subscription
    const activityChannel = supabaseClient.channel('public:peer_activity')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'peer_activity' },
            (payload) => {
                const emptyStateEl = activityFeedEl.querySelector('.empty-state');
                if (emptyStateEl) {
                    activityFeedEl.innerHTML = '';
                }

                const newMessage = payload.new.action_message || "A peer updated a project";
                const newElement = renderActivity(newMessage);
                
                newElement.style.backgroundColor = 'var(--accent-yellow)';
                newElement.style.transition = 'background-color 1s ease';
                
                activityFeedEl.prepend(newElement);
                
                setTimeout(() => {
                    newElement.style.backgroundColor = '#f8f8f8'; 
                }, 1000);

                if(activityFeedEl.children.length > 4) {
                    activityFeedEl.removeChild(activityFeedEl.lastChild);
                }
            }
        )
        .subscribe();


    // --- 4. Logout Functionality ---
    const logoutBtn = document.getElementById('logout-btn');
    logoutBtn.addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });
});
