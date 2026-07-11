document.addEventListener("DOMContentLoaded", () => {
    // Select all elements that should animate in on scroll
    const revealElements = document.querySelectorAll('.section-reveal');

    // Create an Intersection Observer
    const revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            // If the element is in the viewport
            if (entry.isIntersecting) {
                // Add the 'visible' class to trigger CSS transition
                entry.target.classList.add('visible');
                // Stop observing the element once it has been revealed
                observer.unobserve(entry.target);
            }
        });
    }, {
        // Trigger when 15% of the element is visible
        threshold: 0.15,
        // Start triggering slightly before it actually enters to make it smooth
        rootMargin: "0px 0px -50px 0px"
    });

    // Observe each element
    revealElements.forEach(element => {
        revealObserver.observe(element);
    });
});
