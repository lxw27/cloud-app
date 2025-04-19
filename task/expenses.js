import { trace } from "firebase/performance";
import {app, auth, db, perf, firebaseConfig } from './firebase-config.js';

document.addEventListener('DOMContentLoaded', async function() {
    // Initialize Firebase if haven't
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }

    const db = firebase.firestore();

    // DOM elements
    const elements = {
        monthlyBtn: document.getElementById('monthlyBtn'),
        yearlyBtn: document.getElementById('yearlyBtn'),
        periodSelect: document.getElementById('periodSelect'),
        expenseBreakdown: document.getElementById('expenseBreakdown'),
        userMenuButton: document.getElementById('userMenuButton'),
        userMenu: document.getElementById('userMenu'),
        generateReportBtn: document.getElementById('generateReportBtn')
    };

    // State management
    const state = {
        allSubscriptions: [],
        monthlyExpenseData: [],
        yearlyExpenseData: [],
        pieChartInstance: null,
        barChartInstance: null,
        pdfGenerationInProgress: false
    };

    // Initialize auth and load data
    await initializeAuth();
    setupEventListeners();

    // Helper functions
    function capitalizeFirstLetter(string) {
        return string ? string.charAt(0).toUpperCase() + string.slice(1).toLowerCase() : '';
    }

    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return 'Invalid date';
            return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch (e) {
            console.error('Error formatting date:', e);
            return 'Invalid date';
        }
    }

    function getMonthlyEquivalent(cost, billingCycle) {
        return billingCycle?.toLowerCase() === 'yearly' ? cost / 12 : cost;
    }

    function getIconForSubscription(name) {
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

    function generateMonthlyDataForBarChart(activeSubs) {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const monthlyData = [];
    
        for (let i = 0; i < 6; i++) {
            const date = new Date(currentYear, currentMonth - i, 1);
            const monthName = date.toLocaleString('default', { month: 'short' });
            const year = date.getFullYear();
            const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            
            let total = 0;
            activeSubs.forEach(sub => {
                if (sub.next_renewal_date) {
                    const subDate = new Date(sub.next_renewal_date);
                    const subMonthKey = `${subDate.getFullYear()}-${String(subDate.getMonth() + 1).padStart(2, '0')}`;
                    if (subMonthKey === monthKey) {
                        total += getMonthlyEquivalent(sub.cost, sub.billing_cycle);
                    }
                }
            });
            
            monthlyData.push({
                month: `${monthName} ${year}`,
                monthKey,
                total
            });
        }
        
        return monthlyData;
    }
    
    function generateYearlyDataForBarChart(activeSubs) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const yearlyData = [];
    
        for (let i = 0; i < 5; i++) {
            const year = currentYear - i;
            let total = 0;
    
            activeSubs.forEach(sub => {
                if (sub.next_renewal_date) {
                    const subDate = new Date(sub.next_renewal_date);
                    if (subDate.getFullYear() === year) {
                        total += sub.billing_cycle?.toLowerCase() === 'yearly' 
                            ? sub.cost 
                            : sub.cost * 12;
                    }
                }
            });
            
            yearlyData.push({
                year: String(year),
                total
            });
        }
        
        return yearlyData;
    }

    function calculateTotalMonthly() {
        const activeSubs = state.allSubscriptions.filter(sub => sub.status.toLowerCase() === 'active');
        return activeSubs.reduce((sum, sub) => sum + getMonthlyEquivalent(sub.cost, sub.billing_cycle), 0);
    }

    function generateTableRows() {
        return state.allSubscriptions.map(sub => {
            const monthlyEquivalent = getMonthlyEquivalent(sub.cost, sub.billing_cycle);
            return `
                <tr style="border-bottom: 1px solid #E5E7EB;">
                    <td style="padding: 12px;">
                        <div style="display: flex; align-items: center;">
                            <div style="margin-right: 10px; color: #6B7280;">
                                <i class="${getServiceIcon(sub.service_name)}"></i>
                            </div>
                            <div>
                                <div style="font-weight: 500;">${sub.service_name}</div>
                                <div style="font-size: 12px; color: #6B7280;">
                                    <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; 
                                        background-color: ${sub.status.toLowerCase() === 'active' ? '#D1FAE5' : '#FEE2E2'}; 
                                        color: ${sub.status.toLowerCase() === 'active' ? '#065F46' : '#991B1B'};">
                                        ${sub.status}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </td>
                    <td style="padding: 12px;">${capitalizeFirstLetter(sub.billing_cycle?.toLowerCase())}</td>
                    <td style="padding: 12px;">${formatDate(sub.next_renewal_date)}</td>
                    <td style="padding: 12px; text-align: right;">
                        RM ${monthlyEquivalent.toFixed(2)}
                        ${sub.billing_cycle?.toLowerCase() === 'yearly' ? 
                            `<div style="font-size: 12px; color: #6B7280;">(RM ${sub.cost.toFixed(2)}/year)</div>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Auth functions
    async function initializeAuth() {
        try {
            await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            firebase.auth().onAuthStateChanged(handleAuthStateChange);
        } catch (error) {
            console.error('Auth initialization failed:', error);
            window.location.href = 'login.html';
        }
    }

    function handleAuthStateChange(user) {
        if (!user) {
            window.location.href = 'login.html';
            return;
        }
        
        // Update user email in navbar
        const userEmailElement = document.getElementById('userEmailDisplay');
        if (userEmailElement) userEmailElement.textContent = user.email;

        loadUserData(user.uid);
    }

    // Load user data
    async function loadUserData(userId) {
        const t = trace(perf, "load_user_data");
        t.start();

        try {
            await loadSubscriptions(userId);
            generateExpenseData();
            loadExpenseBreakdown();
            updateDashboardMetadata();
            // Initialize dropdown with monthly view by default
            updatePeriodDropdown(true);
            
            // Initialize charts 
            destroyCharts();
            state.pieChartInstance = initPieChart();
            state.barChartInstance = initBarChart(true);

            t.putAttribute('subscriptionCount', state.allSubscriptions.length);
            t.stop();
        } catch (error) {
            t.putAttribute('error', error.message);
            t.stop();
            throw error;
        }
    }

    // Load subscriptions
    async function loadSubscriptions(userId) {
        try {
            const querySnapshot = await db.collection('subscriptions')
            .where('user_id', '==', userId)
            .get();

            state.allSubscriptions = querySnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    ...data,
                    subscription_id: doc.id,
                    next_renewal_date: data.next_renewal_date?.toDate ? data.next_renewal_date.toDate().toISOString() : data.next_renewal_date,
                    created_at: data.created_at?.toDate ? data.created_at.toDate().toISOString() : data.created_at,
                    updated_at: data.updated_at?.toDate ? data.updated_at.toDate().toISOString() : data.updated_at 
                };
            });
        } catch (error) {
            console.error('Error loading subscriptions:', error);
            throw error;
        }
    }

    // Generate monthly and yearly expense data for charts
    function generateExpenseData() {
        // Get active subscriptions
        const activeSubs = state.allSubscriptions.filter(sub => sub.status?.toLowerCase() === 'active');
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        
        // Generate monthly data for last 6 months
        state.monthlyExpenseData = [];
        for (let i = 0; i < 6; i++) {
            const date = new Date(currentYear, currentMonth - i, 1);
            const monthName = date.toLocaleString('default', { month: 'short' });
            const year = date.getFullYear();
            const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            
            // Calculate total for this month
            let total = 0;
            activeSubs.forEach(sub => {
                if (sub.next_renewal_date) {
                    const subDate = new Date(sub.next_renewal_date);
                    const subMonthKey = `${subDate.getFullYear()}-${String(subDate.getMonth() + 1).padStart(2, '0')}`;
                    if (subMonthKey === monthKey) {
                        total += getMonthlyEquivalent(sub.cost, sub.billing_cycle);
                    }
                }
            });
            
            state.monthlyExpenseData.push({
                month: `${monthName} ${year}`,
                monthKey,
                total
            });
        }
        
        // Generate yearly data for the last 5 years
        state.yearlyExpenseData = [];
        for (let i = 0; i < 5; i++) {
            const year = currentYear - i;
            let total = 0;

            activeSubs.forEach(sub => {
                if (sub.next_renewal_date) {
                    const subDate = new Date(sub.next_renewal_date);
                    if (subDate.getFullYear() === year) {
                        total += sub.billing_cycle?.toLowerCase() === 'yearly' 
                            ? sub.cost 
                            : sub.cost * 12;
                    }
                }
            });
            
            state.yearlyExpenseData.push({
                year: String(year),
                total
            });
        }
    }

    // Update dashboard metadata
    function updateDashboardMetadata() {
        const activeSubs = state.allSubscriptions.filter(sub => sub.status.toLowerCase() === 'active');
        const monthlyTotal = activeSubs.reduce((sum, sub) => sum + getMonthlyEquivalent(sub.cost, sub.billing_cycle), 0);
        const yearlyProjection = monthlyTotal * 12;
        const currentDate = new Date().toLocaleDateString('en-US', { 
            month: 'long', 
            day: 'numeric', 
            year: 'numeric' 
        });
        
        // Update metadata in header
        const metaItems = document.querySelectorAll('.meta-item');
        if (metaItems.length >= 3) {
            metaItems[0].innerHTML = `
                <i class="fas fa-calendar-alt meta-icon"></i>
                As of ${currentDate}
            `;
            
            metaItems[1].innerHTML = `
                <i class="fas fa-chart-pie meta-icon"></i>
                Monthly spending: RM ${monthlyTotal.toFixed(2)}
            `;
            
            metaItems[2].innerHTML = `
                <i class="fas fa-chart-line meta-icon"></i>
                Yearly projection: RM ${yearlyProjection.toFixed(2)}
            `;
        }
        
        // Update values in table footer
        const totals = document.querySelectorAll('.totals-value');
        if (totals.length >= 2) {
            totals[0].textContent = `RM ${monthlyTotal.toFixed(2)}`;
            totals[1].textContent = `RM ${yearlyProjection.toFixed(2)}`;
        }
    }

    // Load subscription expenses into table
    function loadExpenseBreakdown() {
        if (!elements.expenseBreakdown) return; 
        elements.expenseBreakdown.innerHTML = '';
        
        state.allSubscriptions.forEach(sub => {
            const monthlyEquivalent = getMonthlyEquivalent(sub.cost, sub.billing_cycle);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <div class="subscription-info">
                        <div class="subscription-icon ${getIconForSubscription(sub.service_name)}">
                            <i class="${getServiceIcon(sub.service_name)}"></i>
                        </div>
                        <div class="subscription-details">
                            <div class="subscription-name">${sub.service_name}</div>
                            <span class="subscription-status" data-status="${sub.status?.toLowerCase()}">
                                ${sub.status}
                            </span>
                        </div>
                    </div>
                </td>
                <td class="billing-cycle">${capitalizeFirstLetter(sub.billing_cycle?.toLowerCase())}</td>
                <td class="billing-date">${formatDate(sub.next_renewal_date)}</td>
                <td class="cost-cell">
                    RM ${monthlyEquivalent.toFixed(2)}
                    ${sub.billing_cycle?.toLowerCase() === 'yearly' ? 
                        `<span class="yearly-cost">(RM ${sub.cost.toFixed(2)}/year)</span>` : ''}
                </td>
            `;
            elements.expenseBreakdown.appendChild(row);
        });
    }

    // Chart functions
    function destroyCharts() {
        if (state.pieChartInstance) {
            state.pieChartInstance.destroy();
            state.pieChartInstance = null;
        }
        if (state.barChartInstance) {
            state.barChartInstance.destroy();
            state.barChartInstance = null;
        }
    }

    // Initialize pie chart for expense distribution
    function initPieChart(filteredSubs = state.allSubscriptions) {
        try {
            const ctx = document.getElementById('pieChart')?.getContext('2d');
            if (!ctx) {
                console.error('Pie chart canvas not found');
                return null;
            }
        
            // Include only active subscriptions
            const activeSubs = filteredSubs.filter(sub => sub.status && sub.status.toLowerCase() === 'active');
            if (activeSubs.length === 0) {
                return new Chart(ctx, {
                    type: 'pie',
                    data: {
                        labels: ['No active subscriptions'],
                        datasets: [{
                            data: [1],
                            backgroundColor: ['rgba(200, 200, 200, 0.2)'],
                            borderColor: 'white',
                            borderWidth: 1
                        }]
                    },
                    options: getPieChartOptions()
                });
            }
            
            const labels = activeSubs.map(sub => sub.service_name);
            const data = activeSubs.map(sub => getMonthlyEquivalent(sub.cost, sub.billing_cycle));
            const colors = [
                'rgba(59, 130, 246, 0.8)',
                'rgba(16, 185, 129, 0.8)',
                'rgba(239, 68, 68, 0.8)',
                'rgba(245, 158, 11, 0.8)',
                'rgba(139, 92, 246, 0.8)',
                'rgba(236, 72, 153, 0.8)'
            ];
            
            return new Chart(ctx, {
                type: 'pie',
                data: {
                    labels,
                    datasets: [{
                        data,
                        backgroundColor: colors,
                        borderColor: 'white',
                        borderWidth: 1
                    }]
                },
                options: getPieChartOptions()
            });
        } catch (error) {
            console.error('Error initializing pie chart:', error);
            return null;
        }
    }

    function getPieChartOptions() {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 10,
                        font: { size: 10 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = Math.round((value / total) * 100);
                            return `${label}: RM ${value.toFixed(2)} (${percentage}%)`;
                        }
                    }
                }
            }
        };
    }

    // Initialize bar chart for expense trends
    function initBarChart(isMonthly = true, filteredSubs = state.allSubscriptions) {
        try {
            const ctx = document.getElementById('barChart')?.getContext('2d');
            if (!ctx) {
                console.error('Bar chart canvas not found');
                return null;
            }

            // Use filtered subscriptions to regenerate chart data
            const activeSubs = filteredSubs.filter(sub => sub.status?.toLowerCase() === 'active');
            const chartData = isMonthly ?
                generateMonthlyDataForBarChart(activeSubs) :
                generateYearlyDataForBarChart(activeSubs);

            if (chartData.length === 0) return null;
            
            const labels = chartData.map(item => isMonthly ? item.month : item.year);
            const data = chartData.map(item => item.total);
            
            // Create or update chart
            return new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: isMonthly ? 'Monthly Expenses (RM)' : 'Yearly Expenses (RM)',
                        data,
                        backgroundColor: 'rgba(59, 130, 246, 0.8)',
                        borderColor: 'rgba(59, 130, 246, 1)',
                        borderWidth: 1
                    }]
                },
                options: getBarChartOptions(isMonthly)
            });
        } catch (error) {
            console.error('Error initializing bar chart:', error);
            return null;
        }
    }

    function getBarChartOptions(isMonthly) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return 'RM ' + value;
                        }
                    }
                },
                x: { reverse: false }
            },
            plugins: { legend: { display: false } }
        };
    }

    // Toggle between monthly and yearly views
    function setupEventListeners() {
        if (elements.monthlyBtn) {
            elements.monthlyBtn.addEventListener('click', () => toggleView(true));
        }

        if (elements.yearlyBtn) {
            elements.yearlyBtn.addEventListener('click', () => toggleView(false));
        }

        if (elements.userMenuButton) {
            elements.userMenuButton.addEventListener('click', () => {
                elements.userMenu.classList.toggle('hidden');
            });

            document.addEventListener('click', (event) => {
                if (!elements.userMenuButton.contains(event.target)) {
                    elements.userMenu.classList.add('hidden');
                }
            });
        }

        if (elements.periodSelect) {
            elements.periodSelect.addEventListener('change', handlePeriodChange);
        }

        if (elements.generateReportBtn) {
            elements.generateReportBtn.addEventListener('click', handleReportGeneration);
        }
    }

    function toggleView(isMonthly) {
        elements.monthlyBtn.classList.toggle('btn-primary', isMonthly);
        elements.monthlyBtn.classList.toggle('btn-secondary', !isMonthly);
        elements.yearlyBtn.classList.toggle('btn-primary', !isMonthly);
        elements.yearlyBtn.classList.toggle('btn-secondary', isMonthly);
        
        updatePeriodDropdown(isMonthly);
        destroyCharts();
        setTimeout(() => {
            state.pieChartInstance = initPieChart();
            state.barChartInstance = initBarChart(isMonthly);
        }, 50);
    }

    // Update period dropdown based on view type
    function updatePeriodDropdown(isMonthly) {
        if (!elements.periodSelect) return;
        
        elements.periodSelect.innerHTML = '';
        const items = isMonthly ? state.monthlyExpenseData : state.yearlyExpenseData;
        
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = isMonthly ? item.monthKey : item.year;
            option.textContent = isMonthly ? item.month : item.year;
            elements.periodSelect.appendChild(option);
        });
        
        if (items.length > 0) {
            elements.periodSelect.value = isMonthly ? items[0].monthKey : items[0].year;
        }
    }

    function handlePeriodChange() {
        const selectedValue = this.value;
        const isMonthly = elements.monthlyBtn.classList.contains('btn-primary');
        const filteredSubs = isMonthly ? 
            filterSubscriptionsByMonth(selectedValue) : 
            filterSubscriptionsByYear(selectedValue);
        
        updateUIWithFilteredData(filteredSubs);
    }

    function filterSubscriptionsByMonth(monthKey) {
        return state.allSubscriptions.filter(sub => {
            if (!sub.next_renewal_date) return false;
            const subDate = new Date(sub.next_renewal_date);
            const subMonthKey = `${subDate.getFullYear()}-${String(subDate.getMonth() + 1).padStart(2, '0')}`;
            return subMonthKey === monthKey;
        });
    }

    function filterSubscriptionsByYear(year) {
        return state.allSubscriptions.filter(sub => {
            if (!sub.next_renewal_date) return false;
            try {
                const subDate = new Date(sub.next_renewal_date);
                return subDate.getFullYear().toString() === year;
            } catch (e) {
                console.error('Invalid date format:', sub.next_renewal_date);
                return false;
            }
        });
    }
    
    function updateUIWithFilteredData(filteredSubs) {
        updateExpenseBreakdownTable(filteredSubs);
        updateChartsWithFilteredData(filteredSubs);
        updateDashboardMetadata();
    }

    function updateExpenseBreakdownTable(filteredSubs) {
        if (!elements.expenseBreakdown) return;
        elements.expenseBreakdown.innerHTML = '';
        
        filteredSubs.forEach(sub => {
            const monthlyEquivalent = getMonthlyEquivalent(sub.cost, sub.billing_cycle);
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>
                    <div class="subscription-info">
                        <div class="subscription-icon ${getIconForSubscription(sub.service_name)}">
                            <i class="${getServiceIcon(sub.service_name)}"></i>
                        </div>
                        <div class="subscription-details">
                            <div class="subscription-name">${sub.service_name}</div>
                            <span class="subscription-status" data-status="${sub.status?.toLowerCase()}">
                                ${sub.status}
                            </span>
                        </div>
                    </div>
                </td>
                <td class="billing-cycle">${capitalizeFirstLetter(sub.billing_cycle?.toLowerCase())}</td>
                <td class="billing-date">${formatDate(sub.next_renewal_date)}</td>
                <td class="cost-cell">
                    RM ${monthlyEquivalent.toFixed(2)}
                    ${sub.billing_cycle?.toLowerCase() === 'yearly' ? 
                        `<span class="yearly-cost">(RM ${sub.cost.toFixed(2)}/year)</span>` : ''}
                </td>
            `;
            elements.expenseBreakdown.appendChild(row);
        });
    }

    function updateChartsWithFilteredData(filteredSubs) {
        destroyCharts();
        const isMonthly = elements.monthlyBtn.classList.contains('btn-primary');
        state.pieChartInstance = initPieChart(filteredSubs);
        state.barChartInstance = initBarChart(isMonthly, filteredSubs);
    }

    // Report generation functions
    async function handleReportGeneration(e) {
        e.preventDefault();
        
        if (state.pdfGenerationInProgress) return;
        state.pdfGenerationInProgress = true;
        
        const originalButtonHTML = elements.generateReportBtn.innerHTML;
        elements.generateReportBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating Preview...';
        elements.generateReportBtn.disabled = true;
        
        try {
            await showPDFPreview();
        } catch (error) {
            console.error('Error generating preview:', error);
            alert('Failed to generate preview: ' + error.message);
        } finally {
            elements.generateReportBtn.innerHTML = originalButtonHTML;
            elements.generateReportBtn.disabled = false;
            state.pdfGenerationInProgress = false;
        }
    }

    function createPreviewModal() {
        let existingModal = document.getElementById('pdfPreviewModal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'pdfPreviewModal';
        modal.className = 'modal hidden';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;

        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        modalContent.style.cssText = `
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            max-width: 90%;
            max-height: 90%;
            overflow: auto;
            position: relative;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        `;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-btn';
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background-color: transparent;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #6B7280;
        `;

        const previewContent = document.createElement('div');
        previewContent.id = 'pdfPreviewContent';
        previewContent.style.marginTop = '20px';

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            justify-content: flex-end;
            margin-top: 20px;
            gap: 10px;
        `;

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.textContent = 'Cancel';

        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'btn btn-primary';
        downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download PDF';

        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(downloadBtn);
        modalContent.appendChild(closeBtn);
        modalContent.appendChild(previewContent);
        modalContent.appendChild(buttonContainer);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        return modal;
    }

    async function showPDFPreview() {
        // Create or get preview modal
        const modal = createPreviewModal();
        const previewContent = document.getElementById('pdfPreviewContent');
        previewContent.innerHTML = '';
        
        // Create report content
        const reportContainer = document.createElement('div');
        reportContainer.className = 'report-container';
        reportContainer.style.cssText = `
            width: 100%;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: white;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        `;
        
        // Add header
        const header = document.createElement('div');
        header.className = 'report-header';
        header.style.marginBottom = '30px';
        header.style.borderBottom = '1px solid #E5E7EB';
        header.style.paddingBottom = '20px';
        header.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h1 style="color: #3B82F6; margin: 0; font-size: 28px; font-weight: 600;">SubTrack Subscription Report</h1>
            </div>
            <p style="margin: 0; color: #6B7280; font-size: 14px;">Generated on ${new Date().toLocaleDateString('en-US', { 
                year: 'numeric', month: 'long', day: 'numeric'
            })}</p>
            <div style="display: flex; justify-content: space-between; margin-top: 20px; background-color: #F9FAFB; padding: 15px; border-radius: 8px;">
                <div style="font-size: 14px;">
                    <div style="display: flex; align-items: center; margin-bottom: 8px;">
                        <i class="fas fa-user-circle" style="margin-right: 8px; color: #6B7280;"></i>
                        <span>${firebase.auth().currentUser?.email || 'User'}</span>
                    </div>
                    <div style="display: flex; align-items: center;">
                        <i class="fas fa-calendar-alt" style="margin-right: 8px; color: #6B7280;"></i>
                        <span>Report Period: ${new Date().toLocaleDateString('en-US', { 
                            year: 'numeric', month: 'long'
                        })}</span>
                    </div>
                </div>
                <div style="font-size: 14px; text-align: right;">
                    <p style="margin: 0 0 8px 0;"><strong>Monthly spending:</strong> RM ${calculateTotalMonthly().toFixed(2)}</p>
                    <p style="margin: 0;"><strong>Yearly projection:</strong> RM ${(calculateTotalMonthly() * 12).toFixed(2)}</p>
                </div>
            </div>
        `;
        reportContainer.appendChild(header);
        
        // Add charts section
        const chartsSection = document.createElement('div');
        chartsSection.className = 'report-charts';
        chartsSection.style.marginBottom = '30px';

        // Create pie chart container
        const pieChartContainer = document.createElement('div');
        pieChartContainer.style.marginBottom = '30px';
        pieChartContainer.style.backgroundColor = '#F9FAFB';
        pieChartContainer.style.padding = '15px';
        pieChartContainer.style.borderRadius = '8px';
        pieChartContainer.innerHTML = `
            <h2 style="color: #4B5563; margin-bottom: 15px; font-size: 18px; font-weight: 600;">Expense Distribution</h2>
            <div style="height: 250px; width: 100%;">
                <canvas id="reportPieChart" height="250" width="400"></canvas>
            </div>
        `;

        // Create bar chart container
        const barChartContainer = document.createElement('div');
        barChartContainer.style.backgroundColor = '#F9FAFB';
        barChartContainer.style.padding = '15px';
        barChartContainer.style.borderRadius = '8px';
        barChartContainer.style.marginTop = '20px';
        barChartContainer.innerHTML = `
            <h2 style="color: #4B5563; margin-bottom: 15px; font-size: 18px; font-weight: 600;">Expense Trend</h2>
            <div style="height: 250px; width: 100%;">
                <canvas id="reportBarChart" height="250" width="400"></canvas>
            </div>
        `;

        chartsSection.appendChild(pieChartContainer);
        chartsSection.appendChild(barChartContainer);
        reportContainer.appendChild(chartsSection);
        
        // Add page break element
        const pageBreak = document.createElement('div');
        pageBreak.style.pageBreakBefore = 'always';
        reportContainer.appendChild(pageBreak);
        
        // Add table section
        const tableSection = document.createElement('div');
        tableSection.className = 'report-table';
        tableSection.innerHTML = `
            <h2 style="color: #4B5563; margin-bottom: 15px; font-size: 18px; font-weight: 600;">Subscription Details</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <thead>
                    <tr style="background-color: #F3F4F6;">
                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E5E7EB; font-weight: 600;">Subscription</th>
                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E5E7EB; font-weight: 600;">Billing Cycle</th>
                        <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E5E7EB; font-weight: 600;">Next Billing</th>
                        <th style="padding: 12px; text-align: right; border-bottom: 2px solid #E5E7EB; font-weight: 600;">Monthly Cost</th>
                    </tr>
                </thead>
                <tbody>
                    ${generateTableRows()}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="3" style="padding: 12px; text-align: right; font-weight: 600; border-top: 2px solid #E5E7EB;">Total Monthly:</td>
                        <td style="padding: 12px; text-align: right; font-weight: 600; border-top: 2px solid #E5E7EB;">RM ${calculateTotalMonthly().toFixed(2)}</td>
                    </tr>
                    <tr>
                        <td colspan="3" style="padding: 12px; text-align: right; font-weight: 600;">Yearly Projection:</td>
                        <td style="padding: 12px; text-align: right; font-weight: 600;">RM ${(calculateTotalMonthly() * 12).toFixed(2)}</td>
                    </tr>
                </tfoot>
            </table>
        `;
        reportContainer.appendChild(tableSection);
        
        // Add to preview content
        previewContent.appendChild(reportContainer);
        
        // Show modal
        modal.classList.remove('hidden');
        
        // Wait for DOM to update
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Initialize charts in report
        initReportCharts();
        
        // Setup modal event listeners
        modal.addEventListener('click', (e) => {
            if (e.target.classList.contains('close-btn') || 
                e.target.closest('.close-btn') ||
                e.target.classList.contains('btn-secondary') || 
                e.target.textContent === 'Cancel' ||
                e.target === modal) {
                modal.classList.add('hidden');
            }
        });

        // Setup download button
        const downloadBtn = modal.querySelector('.btn-primary');
        downloadBtn.onclick = async () => {
            const originalDownloadHTML = downloadBtn.innerHTML;
            downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Downloading...';
            downloadBtn.disabled = true;
            
            try {
                await generatePDFReport();
            } catch (error) {
                console.error('Error generating PDF:', error);
                alert('Failed to generate PDF: ' + error.message);
            } finally {
                downloadBtn.innerHTML = originalDownloadHTML;
                downloadBtn.disabled = false;
                modal.classList.add('hidden');
            }
        };
    }

    // Initialize charts for report
    function initReportCharts() {
        // Init pie chart for report
        const pieCtx = document.getElementById('reportPieChart')?.getContext('2d');
        if (pieCtx) {
            // Include only active subscriptions
            const activeSubs = state.allSubscriptions.filter(sub => sub.status.toLowerCase() === 'active');
            
            if (activeSubs.length > 0) {
                const labels = activeSubs.map(sub => sub.service_name);
                const data = activeSubs.map(sub => getMonthlyEquivalent(sub.cost, sub.billing_cycle));
                
                const colors = [
                    'rgba(59, 130, 246, 0.8)',
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(239, 68, 68, 0.8)',
                    'rgba(245, 158, 11, 0.8)',
                    'rgba(139, 92, 246, 0.8)',
                    'rgba(236, 72, 153, 0.8)'
                ];
                
                new Chart(pieCtx, {
                    type: 'pie',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: data,
                            backgroundColor: colors,
                            borderColor: 'white',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'right',
                                labels: {
                                    boxWidth: 10,
                                    font: {
                                        size: 10
                                    }
                                }
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        const label = context.label || '';
                                        const value = context.parsed || 0;
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = Math.round((value / total) * 100);
                                        return `${label}: RM ${value.toFixed(2)} (${percentage}%)`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        }
        
        // Init bar chart for report
        const barCtx = document.getElementById('reportBarChart')?.getContext('2d');
        if (barCtx) {
            // Check monthly or yearly view
            const isMonthly = elements.monthlyBtn?.classList.contains('btn-primary') || true;
            
            // Prepare data based on view type
            const chartData = isMonthly ? state.monthlyExpenseData : state.yearlyExpenseData;
            
            if (chartData.length > 0) {
                const labels = chartData.map(item => isMonthly ? item.month : item.year);
                const data = chartData.map(item => item.total);
                
                new Chart(barCtx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: isMonthly ? 'Monthly Expenses ($)' : 'Yearly Expenses ($)',
                            data: data,
                            backgroundColor: 'rgba(59, 130, 246, 0.8)',
                            borderColor: 'rgba(59, 130, 246, 1)',
                            borderWidth: 1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: {
                                beginAtZero: true,
                                ticks: {
                                    callback: function(value) {
                                        return 'RM ' + value;
                                    }
                                }
                            }
                        },
                        plugins: {
                            legend: {
                                display: false
                            }
                        }
                    }
                });
            }
        }
    }

    async function generatePDFReport() {
        const contentToPrint = document.getElementById('pdfPreviewContent');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const opt = {
            margin: 10,
            filename: `SubTrack_Report_${new Date().toISOString().split('T')[0]}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { 
                scale: 2,
                logging: false,
                useCORS: true,
                allowTaint: true,
                letterRendering: true
            },
            jsPDF: { 
                unit: 'mm', 
                format: 'a4', 
                orientation: 'portrait'
            },
            pagebreak: { before: '.report-table' }
        };

        try {
            await html2pdf().set(opt).from(contentToPrint).save();
        } catch (error) {
            console.error('PDF generation error:', error);
            throw error;
        }
    }
});