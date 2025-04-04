// Sample data for demonstration
const subscriptions = [
    {
      id: 1,
      name: "Netflix",
      cost: 14.99,
      billingCycle: "monthly",
      nextRenewal: "2025-03-25",
      lastBilled: "2025-02-25",
      status: "active"
    },
    {
      id: 2,
      name: "Spotify",
      cost: 9.99,
      billingCycle: "monthly",
      nextRenewal: "2025-04-05",
      lastBilled: "2025-03-05",
      status: "active"
    },
    {
      id: 3,
      name: "Amazon Prime",
      cost: 139.00,
      billingCycle: "yearly",
      nextRenewal: "2025-06-15",
      lastBilled: "2024-06-15",
      status: "active"
    },
    {
      id: 4,
      name: "New York Times",
      cost: 4.99,
      billingCycle: "monthly",
      nextRenewal: "2025-03-30",
      lastBilled: "2025-02-28",
      status: "active"
    },
    {
      id: 5,
      name: "Hulu",
      cost: 11.99,
      billingCycle: "monthly",
      nextRenewal: "2025-04-02",
      lastBilled: "2025-03-02",
      status: "cancelled"
    }
  ];

  // Generate monthly expense data for the past 6 months
  const monthlyExpenseData = [
    { month: "Oct 2024", total: 81.97 },
    { month: "Nov 2024", total: 82.97 },
    { month: "Dec 2024", total: 82.97 },
    { month: "Jan 2025", total: 82.97 },
    { month: "Feb 2025", total: 87.96 },
    { month: "Mar 2025", total: 89.97 }
  ];

  // Generate yearly expense data for chart
  const yearlyExpenseData = [
    { year: "2021", total: 753.88 },
    { year: "2022", total: 825.76 },
    { year: "2023", total: 876.12 },
    { year: "2024", total: 912.55 },
    { year: "2025", total: 933.64 }
  ];

  // DOM elements
  const monthlyBtn = document.getElementById('monthlyBtn');
  const yearlyBtn = document.getElementById('yearlyBtn');
  const periodSelect = document.getElementById('periodSelect');
  const expenseBreakdown = document.getElementById('expenseBreakdown');

  // Format date to display
  function formatDate(dateString) {
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return new Date(dateString).toLocaleDateString(undefined, options);
  }

  // Calculate monthly equivalent for yearly subscriptions
  function getMonthlyEquivalent(cost, billingCycle) {
    return billingCycle === 'yearly' ? cost / 12 : cost;
  }

  // Load subscription expenses into table
  function loadExpenseBreakdown() {
    expenseBreakdown.innerHTML = '';
    
    subscriptions.forEach(sub => {
      const monthlyEquivalent = getMonthlyEquivalent(sub.cost, sub.billingCycle);
      
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>
          <div class="subscription-info">
            <div class="subscription-icon ${getIconClass(sub.name)}">
              <i class="fas fa-${getIconForSubscription(sub.name)}"></i>
            </div>
            <div class="subscription-details">
              <div class="subscription-name">${sub.name}</div>
              <span class="subscription-status" data-status="${sub.status}">
                ${sub.status === 'active' ? 'Active' : 'Cancelled'}
              </span>
            </div>
          </div>
        </td>
        <td class="billing-cycle">${sub.billingCycle.charAt(0).toUpperCase() + sub.billingCycle.slice(1)}</td>
        <td class="billing-date">${formatDate(sub.nextRenewal)}</td>
        <td class="cost-cell">
          $${monthlyEquivalent.toFixed(2)}
          ${sub.billingCycle === 'yearly' ? 
            `<span class="yearly-cost">($${sub.cost.toFixed(2)}/year)</span>` : ''}
        </td>
      `;
      
      expenseBreakdown.appendChild(row);
    });
  }

  // Get icon for subscription based on name
  function getIconForSubscription(name) {
    const iconMap = {
      'Netflix': 'film',
      'Spotify': 'music',
      'Amazon Prime': 'shipping-fast',
      'New York Times': 'newspaper',
      'Hulu': 'tv',
      'Disney+': 'magic',
      'Youtube Premium': 'video',
      'Apple Music': 'apple',
      'Adobe Creative Cloud': 'palette',
      'Microsoft 365': 'file-word',
      'HBO Max': 'film',
      'PlayStation Plus': 'gamepad'
    };
    
    return iconMap[name] || 'credit-card';
  }

  // Get icon class for subscription
  function getIconClass(name) {
    const classMap = {
      'Netflix': 'icon-netflix',
      'Spotify': 'icon-spotify',
      'Amazon Prime': 'icon-amazon',
      'New York Times': 'icon-news',
      'Hulu': 'icon-hulu'
    };
    
    return classMap[name] || 'icon-default';
  }

  // Initialize pie chart for expense distribution
  function initPieChart() {
    const ctx = document.getElementById('pieChart').getContext('2d');
    
    // Prepare data
    const labels = subscriptions.map(sub => sub.name);
    const data = subscriptions.map(sub => getMonthlyEquivalent(sub.cost, sub.billingCycle));
    
    // Generate colors
    const colors = [
      'rgba(59, 130, 246, 0.8)',
      'rgba(16, 185, 129, 0.8)',
      'rgba(239, 68, 68, 0.8)',
      'rgba(245, 158, 11, 0.8)',
      'rgba(139, 92, 246, 0.8)',
      'rgba(236, 72, 153, 0.8)'
    ];
    
    new Chart(ctx, {
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
                return `${label}: $${value.toFixed(2)} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }

  // Initialize bar chart for expense trends
  function initBarChart(isMonthly = true) {
    const ctx = document.getElementById('barChart').getContext('2d');
    
    // Prepare data based on view type
    const chartData = isMonthly ? monthlyExpenseData : yearlyExpenseData;
    const labels = chartData.map(item => isMonthly ? item.month : item.year);
    const data = chartData.map(item => item.total);
    
    // Create or update chart
    new Chart(ctx, {
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
            beginAtZero: false,
            ticks: {
              callback: function(value) {
                return '$' + value;
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

  // Toggle between monthly and yearly views
  monthlyBtn.addEventListener('click', function() {
    monthlyBtn.classList.remove('btn-secondary');
    monthlyBtn.classList.add('btn-primary');
    
    yearlyBtn.classList.remove('btn-primary');
    yearlyBtn.classList.add('btn-secondary');
    
    // Update period dropdown for months
    updatePeriodDropdown(true);
    
    // Re-init bar chart for monthly view
    document.getElementById('barChart').remove();
    const chartContainer = document.querySelector('.chart-container:nth-of-type(2)');
    const newCanvas = document.createElement('canvas');
    newCanvas.id = 'barChart';
    chartContainer.appendChild(newCanvas);
    initBarChart(true);
  });

  yearlyBtn.addEventListener('click', function() {
    yearlyBtn.classList.remove('btn-secondary');
    yearlyBtn.classList.add('btn-primary');
    
    monthlyBtn.classList.remove('btn-primary');
    monthlyBtn.classList.add('btn-secondary');
    
    // Update period dropdown for years
    updatePeriodDropdown(false);
    
    // Re-init bar chart for yearly view
    document.getElementById('barChart').remove();
    const chartContainer = document.querySelector('.chart-container:nth-of-type(2)');
    const newCanvas = document.createElement('canvas');
    newCanvas.id = 'barChart';
    chartContainer.appendChild(newCanvas);
    initBarChart(false);
  });

  // Update period dropdown based on view type
  function updatePeriodDropdown(isMonthly) {
    periodSelect.innerHTML = '';
    
    if (isMonthly) {
      const months = [
        { value: '2025-03', label: 'March 2025' },
        { value: '2025-02', label: 'February 2025' },
        { value: '2025-01', label: 'January 2025' },
        { value: '2024-12', label: 'December 2024' },
        { value: '2024-11', label: 'November 2024' },
        { value: '2024-10', label: 'October 2024' }
      ];
      
      months.forEach(month => {
        const option = document.createElement('option');
        option.value = month.value;
        option.textContent = month.label;
        periodSelect.appendChild(option);
      });
    } else {
      const years = [
        { value: '2025', label: '2025' },
        { value: '2024', label: '2024' },
        { value: '2023', label: '2023' },
        { value: '2022', label: '2022' },
        { value: '2021', label: '2021' }
      ];
      
      years.forEach(year => {
        const option = document.createElement('option');
        option.value = year.value;
        option.textContent = year.label;
        periodSelect.appendChild(option);
      });
    }
  }

  // Toggle user menu
  document.getElementById('userMenuButton').addEventListener('click', function() {
    const menu = document.getElementById('userMenu');
    menu.classList.toggle('hidden');
  });

  // Initialize
  window.onload = function() {
    loadExpenseBreakdown();
    initPieChart();
    initBarChart(true);
  };