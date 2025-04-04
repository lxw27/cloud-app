document.addEventListener('DOMContentLoaded', async function() {
    // Initialize Firebase
    const firebaseConfig = {
        apiKey: "AIzaSyDtUAf_vVUdR_sknDbFqdAG3lu6Zo0jp9o",
        authDomain: "cloud-c8d3a.firebaseapp.com",
        projectId: "cloud-c8d3a",
        storageBucket: "cloud-c8d3a.appspot.com",
        messagingSenderId: "768752961591",
        appId: "1:768752961591:web:2cafa172dd2fe5a52fd7b2"
    };
    
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    
    // Get DOM elements
    const userMenuButton = document.getElementById('userMenuButton');
    const userMenu = document.getElementById('userMenu');
    const subscriptionModal = document.getElementById('subscriptionModal');
    const deleteModal = document.getElementById('deleteModal');
    const subscriptionForm = document.getElementById('subscriptionForm');
    const openAddModalBtn = document.getElementById('openAddModalBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    
    // Set auth persistence (optional)
    await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    
    // Check auth state
    firebase.auth().onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        
        // Set user email display
        document.getElementById('userEmailDisplay').textContent = user.email;
        
        // Load user's subscriptions
        await loadSubscriptions(user.uid);
        await updateMonthlyTotal(user.uid);
    });

    // Event Listeners
    userMenuButton?.addEventListener('click', toggleUserMenu);
    openAddModalBtn?.addEventListener('click', openAddModal);
    closeModalBtn?.addEventListener('click', closeSubscriptionModal);
    cancelDeleteBtn?.addEventListener('click', closeDeleteModal);
    confirmDeleteBtn?.addEventListener('click', deleteSubscription);

    // Toggle user menu
    function toggleUserMenu() {
        userMenu.classList.toggle('hidden');
    }

    // Close user menu when clicking outside
    document.addEventListener('click', function(event) {
        if (!userMenuButton.contains(event.target) && !userMenu.contains(event.target)) {
            userMenu.classList.add('hidden');
        }
    });

    // Logout functionality
    document.querySelector('.dropdown-item[href="login.html"]').addEventListener('click', function(e) {
        e.preventDefault();
        firebase.auth().signOut().then(() => {
            window.location.href = 'login.html';
        });
    });

    // Core Functions
    async function loadSubscriptions(userId) {
        try {
            const user = firebase.auth().currentUser;
            if (!user) return;
            
            const token = await user.getIdToken();
            const response = await fetch(`http://localhost:8000/api/subscriptions`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });
            
            if (!response.ok) throw new Error('Failed to load subscriptions');
            
            const subscriptions = await response.json();
            renderSubscriptions(subscriptions);
        } catch (error) {
            console.error('Error loading subscriptions:', error);
            showToast('Failed to load subscriptions', 'error');
        }
    }

    async function updateMonthlyTotal(userId) {
        try {
            const user = firebase.auth().currentUser;
            if (!user) return;
            
            const token = await user.getIdToken();
            const response = await fetch(`http://localhost:8000/api/subscriptions/total?user_id=${user.uid}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) throw new Error('Failed to load total');
            
            const data = await response.json();
            document.querySelector('.meta-item:nth-child(2)').innerHTML = `
                <i class="fas fa-credit-card meta-icon"></i>
                Total monthly: $${data.total.toFixed(2)}
            `;
        } catch (error) {
            console.error('Error loading total:', error);
        }
    }
    
    function renderSubscriptions(subscriptions) {
        const tbody = document.getElementById('subscriptionsList');
        tbody.innerHTML = '';

        subscriptions.forEach(sub => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="table-cell">
                    <div class="subscription-info">
                        <div class="subscription-icon ${getLowerCaseServiceName(sub.service_name)}">
                            <i class="fas fa-${getIconForSubscription(sub.service_name)}"></i>
                        </div>
                        <div class="subscription-name">${sub.service_name}</div>
                    </div>
                </td>
                <td class="table-cell">
                    <div class="cost-primary">$${sub.cost.toFixed(2)}</div>
                    ${sub.billing_cycle === 'Yearly' ? `<div class="cost-secondary">$${(sub.cost/12).toFixed(2)}/mo</div>` : ''}
                </td>
                <td class="table-cell">${sub.billing_cycle}</td>
                <td class="table-cell">${formatDate(sub.next_renewal_date)}</td>
                <td class="table-cell">
                    <span class="status-badge ${sub.status === 'Active' ? 'status-active' : 'status-cancelled'}">
                        ${sub.status}
                    </span>
                </td>
                <td class="table-cell">
                    <button class="action-btn edit-btn" data-id="${sub.subscription_id}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn delete-btn" data-id="${sub.subscription_id}">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Add event listeners to action buttons
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => editSubscription(btn.dataset.id));
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => showDeleteModal(btn.dataset.id));
        });
    }

    // Modal Functions
    function openAddModal() {
        document.getElementById('modalTitle').textContent = 'Add New Subscription';
        document.getElementById('subscriptionId').value = '';
        subscriptionForm.reset();
        document.getElementById('nextRenewal').value = new Date().toISOString().split('T')[0];
        subscriptionModal.classList.remove('hidden');
    }

    async function editSubscription(id) {
        try {
            const user = firebase.auth().currentUser;
            if (!user) return;
            
            const token = await user.getIdToken();
            const response = await fetch(`http://localhost:8000/api/subscriptions/${id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                credentials: 'include'
            });
            
            if (!response.ok) throw new Error('Failed to load subscription');
            
            const sub = await response.json();
            document.getElementById('modalTitle').textContent = 'Edit Subscription';
            document.getElementById('subscriptionId').value = sub.subscription_id;
            document.getElementById('subscriptionName').value = sub.service_name;
            document.getElementById('subscriptionCost').value = sub.cost;
            document.getElementById('billingCycle').value = sub.billing_cycle.toLowerCase(); // Ensure case matches
            document.getElementById('nextRenewal').value = sub.next_renewal_date.split('T')[0];
            document.getElementById('subscriptionStatus').value = sub.status.toLowerCase(); // Ensure case matches
            subscriptionModal.classList.remove('hidden');
        } catch (error) {
            console.error('Error loading subscription:', error);
            showToast('Failed to load subscription', 'error');
        }
    }

    function showDeleteModal(id) {
        window.currentSubscriptionId = id;
        deleteModal.classList.remove('hidden');
    }

    function closeSubscriptionModal() {
        subscriptionModal.classList.add('hidden');
    }

    function closeDeleteModal() {
        deleteModal.classList.add('hidden');
    }

    async function deleteSubscription() {
        const id = window.currentSubscriptionId;
        if (!id) return;
        
        try {
            const user = firebase.auth().currentUser;
            const response = await fetch(`http://localhost:8000/api/subscriptions/${id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${await user.getIdToken()}`
                },
                credentials: 'include'
            });
            
            if (!response.ok) throw new Error('Failed to delete subscription');
            
            closeDeleteModal();
            await loadSubscriptions(user.uid);
            updateMonthlyTotal();
            showToast('Subscription deleted successfully', 'success');
        } catch (error) {
            console.error('Error deleting subscription:', error);
            showToast('Failed to delete subscription', 'error');
        }
    }

    // Form Submission
    subscriptionForm?.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const user = firebase.auth().currentUser;
        if (!user) return;
        
        const id = document.getElementById('subscriptionId').value;
        const subData = {
            service_name: document.getElementById('subscriptionName').value,
            cost: parseFloat(document.getElementById('subscriptionCost').value),
            billing_cycle: document.getElementById('billingCycle').value,
            next_renewal_date: document.getElementById('nextRenewal').value,
            status: document.getElementById('subscriptionStatus').value,
            user_id: user.uid
        };
    
        try {
            const token = await user.getIdToken();
            let response;
            if (id) {
                // Update existing subscription
                response = await fetch(`http://localhost:8000/api/subscriptions/${id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(subData),
                    credentials: 'include'
                });
            } else {
                // Create new subscription
                response = await fetch('http://localhost:8000/api/subscriptions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(subData),
                    credentials: 'include'
                });
            }
            
            if (!response.ok) throw new Error(id ? 'Failed to update subscription' : 'Failed to create subscription');
            
            closeSubscriptionModal();
            await loadSubscriptions(user.uid);
            updateMonthlyTotal();
            showToast(`Subscription ${id ? 'updated' : 'added'} successfully`, 'success');
        } catch (error) {
            console.error('Error saving subscription:', error);
            showToast(error.message, 'error');
        }
    });
        

    // Helper Functions
    function formatDate(dateString) {
        return new Date(dateString).toLocaleDateString(undefined, { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
    }

    function getIconForSubscription(name) {
        const iconMap = {
            'Netflix': 'film',
            'Spotify': 'music',
            'Amazon Prime': 'shopping-bag',
            'New York Times': 'newspaper',
            'Hulu': 'tv',
            'YouTube': 'video',
            'Disney+': 'magic',
            'Apple Music': 'music'
        };
        return iconMap[name] || 'credit-card';
    }

    function getLowerCaseServiceName(name) {
        return name.toLowerCase().replace(/\s+/g, '-').replace(/\+/g, 'plus');
    }

    function showToast(message, type) {
        // Implement your toast notification system here
        console.log(`${type}: ${message}`);
    }
});