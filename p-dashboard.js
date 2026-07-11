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
    const username = user.email.split('@')[0];

    const projectSelect = document.getElementById('project-select');
    const createProjectBtn = document.getElementById('create-project-btn');
    const editor = document.getElementById('live-editor');
    const chatMessages = document.getElementById('chat-messages');
    const projectTitleEl = document.getElementById('project-title');
    const collaboratorsEl = document.getElementById('collaborators-list');

    let activeProjectId = null;
    let projectChannel = null;

    // Logout Setup
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = 'index.html';
    });

    // --- 2. Fetch User Projects (Owned + Shared) ---
    const loadUserProjects = async () => {
        // Fetch projects where user is owner OR a member
        const { data: ownedProjects } = await supabaseClient
            .from('projects')
            .select('id, title')
            .eq('owner_id', user.id);

        const { data: sharedProjects } = await supabaseClient
            .from('project_members')
            .select('projects(id, title)')
            .eq('user_email', user.email);

        projectSelect.innerHTML = '<option value="" disabled selected>Select a project...</option>';

        let allProjects = ownedProjects || [];
        if (sharedProjects) {
            sharedProjects.forEach(sp => {
                if (sp.projects && !allProjects.some(p => p.id === sp.projects.id)) {
                    allProjects.push(sp.projects);
                }
            });
        }

        allProjects.forEach(proj => {
            const option = document.createElement('option');
            option.value = proj.id;
            option.textContent = proj.title;
            projectSelect.appendChild(option);
        });
    };

    await loadUserProjects();

    // --- 3. Create Project Handler ---
    createProjectBtn.addEventListener('click', async () => {
        const title = prompt("Enter a name for your new project:");
        if (!title) return;

        try {
            const { data: newProject, error } = await supabaseClient
                .from('projects')
                .insert([{ title: title, owner_id: user.id }])
                .select()
                .single();

            if (error) throw error;

            alert(`Project "${title}" created!`);
            await loadUserProjects();
            
            // Automatically switch to the newly created project
            projectSelect.value = newProject.id;
            switchProject(newProject.id, title);

        } catch (err) {
            alert("Error creating project: " + err.message);
        }
    });

    // Switch active project on dropdown change
    projectSelect.addEventListener('change', (e) => {
        const selectedId = e.target.value;
        const selectedTitle = projectSelect.options[projectSelect.selectedIndex].text;
        switchProject(selectedId, selectedTitle);
    });

    // --- 4. Switch Active Project Workspace ---
    const switchProject = async (id, title) => {
        activeProjectId = id;
        projectTitleEl.textContent = title;
        editor.disabled = false;
        editor.placeholder = "Start typing... Changes sync in real-time.";

        // Cleanup existing channel if switching between projects
        if (projectChannel) {
            supabaseClient.removeChannel(projectChannel);
        }

        // Fetch Collaborators
        const { data: members } = await supabaseClient
            .from('project_members')
            .select('user_email')
            .eq('project_id', activeProjectId);

        const memberList = members ? members.map(m => m.user_email.split('@')[0]).join(', ') : '';
        collaboratorsEl.innerHTML = `Collaborators: ${memberList || 'You'} <button class="btn-small" id="invite-btn">+ Invite</button>`;
        setupInviteHandler();

        // Subscribe to Realtime Editor and Chat
        projectChannel = supabaseClient.channel(`room:${activeProjectId}`);

        projectChannel.on('broadcast', { event: 'doc_edit' }, (payload) => {
            editor.value = payload.payload.text;
        });

        projectChannel.on('postgres_changes', { 
            event: 'INSERT', 
            schema: 'public', 
            table: 'messages',
            filter: `project_id=eq.${activeProjectId}` 
        }, (payload) => {
            if (payload.new.user_id !== user.id) {
                appendMessage(payload.new.sender_name, payload.new.content, 'peer');
            }
        }).subscribe();
    };

    // Keystroke broadcasting
    editor.addEventListener('input', (e) => {
        if (!activeProjectId || !projectChannel) return;
        projectChannel.send({
            type: 'broadcast',
            event: 'doc_edit',
            payload: { text: e.target.value }
        });
    });

    // --- 5. Chat & AI Command System ---
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');

    const appendMessage = (sender, text, type = 'self') => {
        const msg = document.createElement('div');
        msg.className = `message ${type}`;
        msg.innerHTML = `<strong>${sender}:</strong> ${text}`;
        chatMessages.appendChild(msg);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    };

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (!text) return;

        chatInput.value = '';
        appendMessage('You', text, 'self');

        if (text.startsWith('/ai ')) {
            const prompt = text.replace('/ai ', '');
            await handleAICommand(prompt);
        } else if (activeProjectId) {
            await supabaseClient.from('messages').insert([{
                project_id: activeProjectId,
                user_id: user.id,
                sender_name: username,
                content: text
            }]);
        }
    });

    const handleAICommand = async (prompt) => {
        appendMessage('System', 'DeepSeek AI thinking...', 'system');
        
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
                        { role: "system", content: "You are StudySync AI, a helpful study assistant. Keep answers concise." },
                        { role: "user", content: prompt }
                    ]
                })
            });

            const data = await response.json();
            const aiResponse = data.choices[0].message.content;
            
            if (chatMessages.lastChild) chatMessages.lastChild.remove();
            appendMessage('DeepSeek AI', aiResponse, 'ai');

        } catch (error) {
            if (chatMessages.lastChild) chatMessages.lastChild.remove();
            appendMessage('System', 'AI request failed.', 'system');
        }
    };

    // Invite Member Handler
    function setupInviteHandler() {
        const inviteBtn = document.getElementById('invite-btn');
        if (inviteBtn) {
            inviteBtn.addEventListener('click', async () => {
                const email = prompt("Enter email of user to invite to this project:");
                if (email && activeProjectId) {
                    const { error } = await supabaseClient
                        .from('project_members')
                        .insert([{ project_id: activeProjectId, user_email: email }]);

                    if (error) alert("Could not add user: " + error.message);
                    else alert(`Added ${email} to project!`);
                }
            });
        }
    }
});
