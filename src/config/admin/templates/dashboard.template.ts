export const dashboardTemplate = `import React from 'react';

export const Dashboard = () => {

    return (
        <div style={{
            backgroundColor: 'white',
            borderRadius: '15px',
            height: '100%',
            padding: '1rem',
            margin: '1rem',
        }}>
            <h1 style={{fontSize: "1.5rem", textAlign: "center"}}>Dashboard</h1>
            <div style={{
                display: 'flex',
                gap: '1rem',
                flexDirection: 'column',
                textAlign: 'center',
                marginTop: '3rem',
                borderRadius: '15px',
                border: '2px solid gainsboro',
                maxWidth: '300px',
                margin: '3rem auto',
                padding: '1rem',
            }}>
                <h2>Customize it!</h2>
                <p>You can customize your dashboard however you want.</p>
                <p>Display any data you might find useful.</p>
                <p>See the number of users or check statistics on graphics</p>
                <p>Whatever you want to do! Edit it on components/dashboard.</p>
            </div>
        </div>

    );
};

export default Dashboard;`