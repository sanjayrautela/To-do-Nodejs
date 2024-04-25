const todoDataValidation = ({todoText}) => {
    return new Promise((resolve,reject) => {
        if(!todoText) reject("missing todo text");

        

        // if(todoText.length <3 || todoText >100)
        //     reject("todo length should be 3-100");

        resolve();
    });
};

module.exports = {todoDataValidation};