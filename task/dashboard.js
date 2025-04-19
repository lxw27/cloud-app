import {app, auth, db, perf, firebaseConfig } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', async function() {
    // DOM elements
    const elements = {
        userMenuButton: document.getElementById('userMenuButton'),
        userMenu: document.getElementById('userMenu'),
        subscriptionModal: document.getElementById('subscriptionModal'),
        deleteModal: document.getElementById('deleteModal'),
        subscriptionForm: document.getElementById('subscriptionForm'),
        openAddModalBtn: document.getElementById('openAddModalBtn'),
        closeModalBtn: document.getElementById('closeModalBtn'),
        cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
        confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
        searchInput: document.getElementById('search'),
        statusFilter: document.getElementById('status-filter'),
        cycleFilter: document.getElementById('cycle-filter'),
        priceMinInput: document.getElementById('price-min'),
        priceMaxInput: document.getElementById('price-max'),
        minPriceValue: document.getElementById('min-price-value'),
        maxPriceValue: document.getElementById('max-price-value'),
        sortBySelect: document.getElementById('sort-by'),
        applyFiltersBtn: document.getElementById('applyFiltersBtn'),
        applyFiltersMenu: document.getElementById('applyFiltersMenu'),
        subscriptionsList: document.getElementById('subscriptionsList'),
        sliderTrack: document.getElementById('slider-track')
    };    

    // Initialize Firebase if haven't
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    const db = firebase.firestore();
    let allSubscriptions = [];
    let currentSubscriptionId = null;

    const BillingCycle = {
        MONTHLY: "Monthly",
        YEARLY: "Yearly"
    };

    const Status = {
        ACTIVE: "Active",
        CANCELLED: "Cancelled"
    };

    // Initialize Auth
    await initializeAuth();
    
    // Setup event listeners
    setupEventListeners();

    // Initialize Auth
    async function initializeAuth() {
        await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
        firebase.auth().onAuthStateChanged(handleAuthStateChange);
    }

    function handleAuthStateChange(user) {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        
        document.getElementById('userEmailDisplay').textContent = user.email;
        loadUserData(user.uid);
    }

    // Load user data (subscriptions)
    async function loadUserData(userId) {
        await Promise.all([
            loadSubscriptions(userId),
            updateDashboardMetadata(userId)
        ]);
    }

    // Setup event listeners
    function setupEventListeners() {
        // User menu
        elements.userMenuButton?.addEventListener('click', toggleUserMenu);
        document.addEventListener('click', handleOutsideClick);

        // Modals
        elements.openAddModalBtn?.addEventListener('click', openAddModal);
        elements.closeModalBtn?.addEventListener('click', closeSubscriptionModal);
        elements.cancelDeleteBtn?.addEventListener('click', closeDeleteModal);
        elements.confirmDeleteBtn?.addEventListener('click', deleteSubscription);

        // Search and filters
        elements.searchInput?.addEventListener('input', debounce(applyFilters, 300));
        elements.statusFilter?.addEventListener('change', applyFilters);
        elements.cycleFilter?.addEventListener('change', applyFilters);
        elements.sortBySelect?.addEventListener('change', applyFilters);

        // Price range
        elements.priceMinInput?.addEventListener('input', handlePriceRangeUpdate);
        elements.priceMaxInput?.addEventListener('input', handlePriceRangeUpdate);

        // Advanced filters
        elements.applyFiltersBtn?.addEventListener('click', () => {
            applyFilters();
            toggleApplyFiltersMenu();
        });

        // Form submission
        elements.subscriptionForm?.addEventListener('submit', handleFormSubmission);

        // Logout
        document.querySelector('.dropdown-item[href="login.html"]')?.addEventListener('click', handleLogout);
    }

    // Load subscriptions data from database
    async function loadSubscriptions(userId) {
        try {
            const user = firebase.auth().currentUser;
            if (!user) return;
            
            const querySnapshot = await db.collection('subscriptions')
            .where('user_id', '==', userId)
            .get();
            
            allSubscriptions = querySnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    ...data,
                    subscription_id: doc.id,
                    next_renewal_date: data.next_renewal_date?.toDate ? data.next_renewal_date.toDate().toISOString() : data.next_renewal_date,
                    created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at,
                    updated_at: data.updated_at?.toDate ? data.updated_at.toDate().toISOString() : data.updated_at 
                };
            });
            initPriceRange();
            applyFilters();
        } catch (error) {
            console.error('Error loading subscriptions:', error);
            showMessage('Failed to load subscriptions', 'error');
        }
    }

    // Render obtained subscription data for display
    function renderSubscriptions(subscriptions) {
        const tbody = elements.subscriptionsList;
        tbody.innerHTML = '';

        subscriptions.forEach(sub => {
            const status = capitalizeFirstLetter(sub.status.toLowerCase());
            const billingCycle = capitalizeFirstLetter(sub.billing_cycle.toLowerCase());
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td class="table-cell">
                    <div class="subscription-info">
                        <div class="subscription-icon ${getServiceClassName(sub.service_name)}">
                            <i class="${getServiceIcon(sub.service_name)}"></i>
                        </div>
                        <div class="subscription-name">${sub.service_name}</div>
                    </div>
                </td>
                <td class="table-cell">
                    <div class="cost-primary">RM ${sub.cost.toFixed(2)}</div>
                    ${billingCycle === 'Yearly' ? `<div class="cost-secondary">RM ${(sub.cost/12).toFixed(2)}/mo</div>` : ''}
                </td>
                <td class="table-cell">${billingCycle}</td>
                <td class="table-cell">${formatDate(sub.next_renewal_date)}</td>
                <td class="table-cell">
                    <span class="status-badge ${status.toLowerCase() === 'active' ? 'status-active' : 'status-cancelled'}">
                        ${status}
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

        // Add event listeners to dynamically created buttons
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => editSubscription(btn.dataset.id));
        });

        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => showDeleteModal(btn.dataset.id));
        });
    }

    // Popup window for adding subscription
    function openAddModal() {
        document.getElementById('modalTitle').textContent = 'Add New Subscription';
        document.getElementById('subscriptionId').value = '';
        elements.subscriptionForm.reset();
        setMinDateForInput();
        document.getElementById('nextRenewal').value = new Date().toISOString().split('T')[0];
        elements.subscriptionModal.classList.remove('hidden');
    }

    // Function for editing subscription
    async function editSubscription(id) {
        try {
            const user = await ensureAuthenticated();
            const doc = await db.collection('subscriptions').doc(id).get();
            
            if (!doc.exists) throw new Error('Subscription not found');
            
            const sub = doc.data();
            document.getElementById('modalTitle').textContent = 'Edit Subscription';
            document.getElementById('subscriptionId').value = doc.id;
            document.getElementById('subscriptionName').value = sub.service_name;
            document.getElementById('subscriptionCost').value = sub.cost;
            document.getElementById('billingCycle').value = sub.billing_cycle.toLowerCase();
            
            setMinDateForInput();
            document.getElementById('nextRenewal').value = sub.next_renewal_date?.toDate ? 
                sub.next_renewal_date.toDate().toISOString().split('T')[0] : 
                sub.next_renewal_date.split('T')[0];
            document.getElementById('subscriptionStatus').value = sub.status.toLowerCase();

            elements.subscriptionModal.classList.remove('hidden');
        } catch (error) {
            console.error('Error loading subscription:', error);
            showMessage('Failed to load subscription', 'error');
        }
    }

    // Popup window for confirming delete subscription
    function showDeleteModal(id) {
        currentSubscriptionId = id;
        elements.deleteModal.classList.remove('hidden');
    }

    // Close modals
    function closeSubscriptionModal() {
        elements.subscriptionModal.classList.add('hidden');
    }

    function closeDeleteModal() {
        elements.deleteModal.classList.add('hidden');
    }

    // Function for deleting subscription
    async function deleteSubscription() {
        if (!currentSubscriptionId) return;
        
        try {
            const user = await ensureAuthenticated();
            await db.collection('subscriptions').doc(currentSubscriptionId).delete();
            
            updateLocalStorageTimestamp();
            closeDeleteModal();
            await loadUserData(user.uid);
            showMessage('Subscription deleted successfully', 'success');
        } catch (error) {
            console.error('Error deleting subscription:', error);
            showMessage('Failed to delete subscription', 'error');
        }
    }

    // Form handling for adding and editing subscription
    async function handleFormSubmission(e) {
        e.preventDefault();
        
        const user = await ensureAuthenticated();
        const id = document.getElementById('subscriptionId').value;
        
        const subData = {
            service_name: document.getElementById('subscriptionName').value,
            cost: parseFloat(document.getElementById('subscriptionCost').value),
            billing_cycle: capitalizeFirstLetter(document.getElementById('billingCycle').value),
            next_renewal_date: document.getElementById('nextRenewal').value,
            status: capitalizeFirstLetter(document.getElementById('subscriptionStatus').value),
            user_id: user.uid
        };
    
        try {
            if (id) {
                // Update existing subscription
                await db.collection('subscriptions').doc(id).update({
                    ...subData,
                    updated_at: firebase.firestore.FieldValue.serverTimestamp()
                });
            } else {
                // Create new subscription
                await db.collection('subscriptions').add({
                    ...subData,
                    created_at: firebase.firestore.FieldValue.serverTimestamp(),
                    updated_at: firebase.firestore.FieldValue.serverTimestamp()
                });
            }
            
            updateLocalStorageTimestamp();
            closeSubscriptionModal();
            await loadUserData(user.uid);
            showMessage(`Subscription ${id ? 'updated' : 'added'} successfully`, 'success');
        } catch (error) {
            console.error('Error saving subscription:', error);
            showMessage(error.message, 'error');
        }
    }

    // Functions for filtering and sorting subscriptions
    function applyFilters() {
        const searchTerm = elements.searchInput.value.toLowerCase();
        const statusFilterValue = elements.statusFilter.value;
        const cycleFilterValue = elements.cycleFilter.value;
        const minPrice = parseFloat(elements.priceMinInput.value);
        const maxPrice = parseFloat(elements.priceMaxInput.value);
        const sortBy = elements.sortBySelect.value;
        
        let filteredSubs = allSubscriptions.filter(sub => {
            // Search filter
            const matchesSearch = searchTerm 
                ? sub.service_name.toLowerCase().includes(searchTerm)
                : true;
            
            // Status filter
            const matchesStatus = statusFilterValue !== 'all' 
                ? sub.status.toLowerCase() === statusFilterValue
                : true;
            
            // Billing cycle filter
            const matchesCycle = cycleFilterValue !== 'all' 
                ? sub.billing_cycle.toLowerCase() === cycleFilterValue
                : true;
            
            // Price range filter
            const matchesPrice = sub.cost >= minPrice && sub.cost <= maxPrice;
            
            return matchesSearch && matchesStatus && matchesCycle && matchesPrice;
        });
        
        // Apply sorting
        filteredSubs.sort((a, b) => {
            switch (sortBy) {
                case 'name-asc': return a.service_name.localeCompare(b.service_name);
                case 'name-desc': return b.service_name.localeCompare(a.service_name);
                case 'price-asc': return a.cost - b.cost;
                case 'price-desc': return b.cost - a.cost;
                case 'renewal-asc': return new Date(a.next_renewal_date) - new Date(b.next_renewal_date);
                case 'renewal-desc': return new Date(b.next_renewal_date) - new Date(a.next_renewal_date);
                default: return 0;
            }
        });
        
        renderSubscriptions(filteredSubs);
    }

    // Functions for filtering using price range
    function initPriceRange() {
        if (allSubscriptions.length === 0) return;

        const prices = allSubscriptions.map(sub => sub.cost);
        const minPrice = Math.floor(Math.min(...prices));
        const maxPrice = Math.ceil(Math.max(...prices));
        
        elements.priceMinInput.min = minPrice;
        elements.priceMinInput.max = maxPrice;
        elements.priceMinInput.value = minPrice;
        
        elements.priceMaxInput.min = minPrice;
        elements.priceMaxInput.max = maxPrice;
        elements.priceMaxInput.value = maxPrice;
        
        elements.minPriceValue.textContent = minPrice;
        elements.maxPriceValue.textContent = maxPrice;

        updateSliderTrack();
    }

    function handlePriceRangeUpdate() {
        const minVal = parseInt(elements.priceMinInput.value);
        const maxVal = parseInt(elements.priceMaxInput.value);
        
        if (minVal > maxVal) {
            elements.priceMinInput.value = maxVal;
        }
        if (maxVal < minVal) {
            elements.priceMaxInput.value = minVal;
        }
        
        elements.minPriceValue.textContent = elements.priceMinInput.value;
        elements.maxPriceValue.textContent = elements.priceMaxInput.value;
        updateSliderTrack();
        applyFilters();
    }

    function updateSliderTrack() {
        const minVal = parseInt(elements.priceMinInput.value);
        const maxVal = parseInt(elements.priceMaxInput.value);
        const minPossible = parseInt(elements.priceMinInput.min);
        const maxPossible = parseInt(elements.priceMaxInput.max);
        
        const leftPercent = ((minVal - minPossible) / (maxPossible - minPossible)) * 100;
        const rightPercent = 100 - ((maxVal - minPossible) / (maxPossible - minPossible)) * 100;
        
        elements.sliderTrack.style.left = `${leftPercent}%`;
        elements.sliderTrack.style.right = `${rightPercent}%`;
    }

    // Function to obtain and display dashboard metadata
    async function updateDashboardMetadata(userId) {
        try {
            const user = await ensureAuthenticated();
            
            // Get subscriptions
            const subscriptionsQuery = await db.collection('subscriptions')
                .where('user_id', '==', userId)
                .get();
                
            const subscriptions = subscriptionsQuery.docs.map(doc => {
                const data = doc.data();

                const convertFirestoreTimestamp = (timestamp) => {
                    if (!timestamp) return null;
                    if (typeof timestamp.toDate === 'function') {
                        return timestamp.toDate();
                    }
                    if (timestamp.seconds) {
                        return new Date(timestamp.seconds * 1000);
                    }
                    return new Date(timestamp);
                };

                return {
                    ...data,
                    subscription_id: doc.id,
                    next_renewal_date: convertFirestoreTimestamp(data.next_renewal_date),
                    updated_at: convertFirestoreTimestamp(data.updated_at),
                    created_at: convertFirestoreTimestamp(data.created_at)
                };
            });
            
            // Calculate total monthly cost
            let totalMonthly = 0;
            const activeSubs = subscriptions.filter(sub => sub.status.toLowerCase() === 'active');
            
            activeSubs.forEach(sub => {
                totalMonthly += sub.cost / (sub.billing_cycle.toLowerCase() === 'yearly' ? 12 : 1);
            });
            
            // Update last updated time
            let lastUpdated = localStorage.getItem('lastSubscriptionUpdate');
            if (!lastUpdated && subscriptions.length > 0) {
                const timestamps = subscriptions
                    .map(sub => sub.updated_at || sub.created_at)
                    .filter(date => date instanceof Date && !isNaN(date.getTime()));

                if (timestamps.length > 0) {
                    lastUpdated = new Date(Math.max(...timestamps.map(d => d.getTime())));
                }
            }
            
            // Find next renewal
            let nextRenewal = findNextRenewal(subscriptions);
            
            // Update UI
            updateMetadataUI(lastUpdated, totalMonthly, nextRenewal);
        } catch (error) {
            console.error('Error updating dashboard metadata:', error);
        }
    }

    function findNextRenewal(subscriptions) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        
        let nextRenewal = null;
        const activeSubs = subscriptions.filter(sub => sub.status.toLowerCase() === 'active');
        
        activeSubs.forEach(sub => {
            try {
                if (!sub.next_renewal_date) return;
                const renewalDate = new Date(sub.next_renewal_date);
                renewalDate.setHours(0, 0, 0, 0);
                
                if (renewalDate >= now && (!nextRenewal || renewalDate < new Date(nextRenewal.next_renewal_date))) {
                    nextRenewal = sub;
                }
            } catch (e) {
                console.error('Invalid date for subscription:', sub);
            }
        });
        
        return nextRenewal;
    }

    function updateMetadataUI(lastUpdated, totalMonthly, nextRenewal) {
        const metaItems = document.querySelectorAll('.meta-item');
        
        metaItems[0].innerHTML = `
            <i class="fas fa-calendar-alt meta-icon"></i>
            Last updated: ${lastUpdated ? formatDate(lastUpdated) : 'Never'}
        `;
        
        metaItems[1].innerHTML = `
            <i class="fas fa-credit-card meta-icon"></i>
            Total monthly: RM ${totalMonthly.toFixed(2)}
        `;
        
        metaItems[2].innerHTML = `
            <i class="fas fa-clock meta-icon"></i>
            ${nextRenewal 
                ? `Next renewal: ${nextRenewal.service_name} (${formatDate(nextRenewal.next_renewal_date, false)})` 
                : 'No upcoming renewals'}
        `;
    }

    // Helper functions 
    function setMinDateForInput() {
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        document.getElementById('nextRenewal').min = `${yyyy}-${mm}-${dd}`;
    }

    function formatDate(dateString, includeYear = true) {
        if (!dateString) return 'Invalid date';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return 'Invalid date';
        
        const day = date.getDate();
        const month = date.toLocaleString('default', { month: 'short' });
        if (!includeYear) return `${day} ${month}`;
        
        const year = date.getFullYear();
        return `${day} ${month} ${year}`;
    }

    function getServiceIcon(name) {
        const iconMap = {
            'Netflix': 'fa-brands fa-netflix',
            'Spotify': 'fa-brands fa-spotify',
            'Amazon Prime': 'fa-brands fa-amazon',
            'Hulu': 'fa-brands fa-hulu',
            'YouTube': 'fa-brands fa-youtube',
            'Disney+': 'fa-brands fa-disney',
            'Apple Music': 'fa-brands fa-apple',
            'New York Times': 'fa-solid fa-newspaper',
            'Adobe Creative Cloud': 'fa-solid fa-palette',
            'Microsoft 365': 'fa-solid fa-file-word',
            'HBO Max': 'fa-solid fa-film',
            'PlayStation Plus': 'fa-solid fa-gamepad',
            'YouTube Premium': 'fa-solid fa-video',
            'Default': 'fa-solid fa-question-circle'
        };
        return iconMap[name] || 'fa-solid fa-credit-card';
    }

    function getServiceClassName(name) {
        return name.toLowerCase().replace(/\s+/g, '-').replace(/\+/g, 'plus');
    }

    function capitalizeFirstLetter(string) {
        return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
    }

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    }

    function updateLocalStorageTimestamp() {
        localStorage.setItem('lastSubscriptionUpdate', new Date().toISOString());
    }

    async function ensureAuthenticated() {
        const user = firebase.auth().currentUser;
        if (!user) {
            window.location.href = 'login.html';
            throw new Error('User not authenticated');
        }
        return user;
    }

    function toggleUserMenu() {
        elements.userMenu.classList.toggle('hidden');
    }

    function handleOutsideClick(event) {
        if (!elements.userMenuButton.contains(event.target) && !elements.userMenu.contains(event.target)) {
            elements.userMenu.classList.add('hidden');
        }
    }

    function toggleApplyFiltersMenu() {
        elements.applyFiltersMenu.classList.toggle('hidden');
    }

    function handleLogout(e) {
        e.preventDefault();
        firebase.auth().signOut().then(() => {
            window.location.href = 'login.html';
        });
    }

    function showMessage(message, type) {
        console.log(`${type.toUpperCase()}: ${message}`);
    }
});