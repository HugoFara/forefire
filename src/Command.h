/**
 * @file Command.h
 * @brief Definitions for main interaction class, contains all comands logics that are activated py the interpreter.
 * @copyright Copyright (C) 2025 ForeFire, Fire Team, SPE, CNRS/Universita di Corsica.
 * @license This program is free software; See LICENSE file for details. (See LICENSE file).
 * @author Jean‑Baptiste Filippi — 2025
 */

#ifndef COMMAND_H_
#define COMMAND_H_

#include <getopt.h>
#include "ForeFireAtom.h"
#include "SimulationParameters.h"
#include "FireDomain.h"
#include "StringRepresentation.h"
#include "TimeTable.h"
#include "Simulator.h"
#include "FireFront.h"
#include "FireNode.h"
#include "include/Futils.h"
#include "EventCommand.h"
#include <vector>
#include <algorithm>
#include "HttpCommandServer.hpp"

#ifndef COMMAND_DEBUG
#define COMMAND_DEBUG 1<<8

#endif




namespace libforefire {

/*! \class Command
 * \brief Commands for driving a ForeFire simulation (singleton class)
 *
 *  Command is a singleton class that
 *  defines the entry points for user-defined actions
 *  thus enabling driving a ForeFire simulation.
 */

class Command {

	/*! \class BadOption
	 * \brief dummy class for exception handling
	 * in case of a bad option inside the command */
	class BadOption {};
	/*! \class MissingTime
	 * \brief dummy class for exception handling
	 * in case of missing time inside the command */
	class MissingTime {};
	/*! \class MissingOption
	 * \brief dummy class for exception handling
	 * in case of a missing option inside the command */
	class MissingOption {
	public:
		size_t num;
		MissingOption(size_t n):num(n){}
	};

	static Command value; /*!< value of the singleton */

	Command&	operator=(Command&); // Disallowed
	Command(const Command&); // Disallowed


	size_t currentLevel; /*!< current level of the command */

	// Definition of the command map alias.
	// A pointer-to-member rather than a plain function pointer: the handlers
	// act on one Command's session, so each has to be called on an instance.
	// The table itself stays static, being immutable and shared safely.
	typedef int (Command::*cmd)(const string&, size_t&);
	typedef map<string,cmd> commandMap;  /*!< map of aliases between strings and functions to be called */
	static const int numberCommands = 22; /*!< number of possible commands */
	static commandMap makeCmds(){
		// Construction of the command translator
		commandMap trans;
		trans["FireDomain"] = &Command::createDomain;
		trans["FireNode"] = &Command::addFireNode;
		trans["FireFront"] = &Command::createFireFront;
		trans["startFire"] = &Command::startFire;
		trans["step"] = &Command::stepSimulation;
		trans["goTo"] = &Command::goTo;
		trans["print"] = &Command::printSimulation;
		trans["save"] = &Command::saveSimulation;
		trans["plot"] = &Command::plotSimulation;
		trans["computeSpeed"] = &Command::computeModelSpeed;
		trans["addLayer"] = &Command::addLayer;
		trans["setParameter"] = &Command::setParameter;
		trans["setParameters"] = &Command::setParameters;
		trans["getParameter"] = &Command::getParameter;
		trans["trigger"] = &Command::triggerValue;
		trans["include"] = &Command::include;
		trans["loadData"] = &Command::loadData;
		trans["systemExec"] = &Command::systemExec;
		trans["listenHTTP"] = &Command::listenHTTP;
		trans["clear"] = &Command::clear;
		trans["quit"] = &Command::quit;
		trans["emit"] = &Command::emit;

		return trans;
	}
	/* A map of the commands to their effective functions */
	static const commandMap translator;  /*!< map of aliases between strings and functions to be called */


	// Boolean for parallel simulation
	bool parallel;

	// Boolean for initialization
	bool init;
	bool currentFrontCompleted;

	// Time interval of a step of the simulation
	double startTime;
	double endTime;

	enum Status {
		normal = 0,	error = 1
	};

	bool firstCommand;
	size_t refTabs;

	FFPoint* lastReadLoc;
	FireNode* previousNode;
	FireNode* leftLinkNode;
	FireNode* rightLinkNode;

	double bmapOutputUpdate;
	int numBmapOutputs;
	int numAtmoIterations;

	/*! \brief command to create the desired fire domain */
	int createDomain(const string&, size_t&);
	/*! \brief command to create a firenode */
	int addFireNode(const string&, size_t&);
	/*! \brief command to create a firefront from a location point*/
	int startFire(const string&, size_t&);
	/*! \brief command to create a firefront */
	int createFireFront(const string&, size_t&);
	/*! \brief command to run the simulation for the desired amount of time */
	int stepSimulation(const string&, size_t&);
	/*! \brief command to run the simulation till the desired time */
	int goTo(const string&, size_t&);
	/*! \brief command to save in print format the simulation */
	int printSimulation(const string&, size_t&);
	/*! \brief command to save in print format the simulation */
	int saveSimulation(const string&, size_t&);
	/*! \brief command to load in print format the simulation */
	int addLayer(const string&, size_t&);
	/*! \brief command to plot in png/jpg format the simulation */
	int plotSimulation(const string&, size_t&);
	/*! \brief command to get speed and cout a double */
	int computeModelSpeed(const string&, size_t&);
	/*! \brief command to set a given parameter */
	int setParameter(const string&, size_t&);
	/*! \brief command to set a given list of parameters */
	int setParameters(const string&, size_t&);
	/*! \brief command to get a given parameters */
	int getParameter(const string&, size_t&);
	/*! \brief command to include a file */
	int triggerValue(const string&, size_t&);
	/*! \brief command to trigger values that will modifie runtime model parameterisation */
	int include(const string&, size_t&);


	/*! \brief command to load a NC data file */
	int loadData(const string&, size_t&);
	/*! \brief command to save a NC landscape data file */
	int saveData(const string&, size_t&);


	/*! \brief command to clear the simulation */
	int systemExec(const string&, size_t&);
	/*! \brief command to run a system trough pipe */
	int clear(const string&, size_t&);
	/*! \brief command to quit the ForeFire shell */
	int quit(const string&, size_t&);
    /*! \brief command to quit the ForeFire shell */
    int listenHTTP(const string&, size_t &) ;
	/*! \brief command to emit a flux over a given area for a time span */
	int emit(const string&, size_t&);

	string executeCommandAndCaptureOutput(const std::string &cmd);
    
	/*! \brief splits the command into the desired options */
	static void tokenize(const string&, vector<string>&, const string&);
	/*! \brief reads the value of the desired string */
	static string getString(string, string);
	/*! \brief reads the value of the desired int */
	static int getInt(string, string);
	/*! \brief reads the value of the desired double */
	static double getFloat(string, string);
	/*! \brief reads the value of the desired FFPoint */
	FFPoint getPoint(string, string);
	/*! \brief reads the value of the desired FFVector */
	
	std::vector<FFPoint> getPoly(const std::string &, const std::string &);

	static FFVector getVector(string, string);
	/*! \brief counts the arguments in the commands */
	static size_t argCount(string);
	/*! \brief counting the tabs in the commands */
	size_t tabsCount(string);
	/*! \brief remove the tabs in the commands */
	static string removeTabs(string);

    void writeImage(const char* filename, const std::vector<std::vector<double>>& matrix,
                           double forced_min_val = std::numeric_limits<double>::quiet_NaN(),
                           double forced_max_val = std::numeric_limits<double>::quiet_NaN(),
                           const std::string& colormap = "grayscale"); // Default to grayscale if no colormap is specified.


    static void writeHistogram(const char* filename, const std::vector<std::vector<double>>& matrix,   int bins = 100,                        
							double forced_min_val = std::numeric_limits<double>::quiet_NaN(),
                            double forced_max_val = std::numeric_limits<double>::quiet_NaN(),
							
							const std::string& colormap = "grayscale") ;

    static void parseColorMap(const std::string& , std::vector<std::array<unsigned char, 4>>& ) ;

	static void writeASCII(const char *, const std::vector<std::vector<double>>& , double , double , double , double );
    static void writeNetCDF(const char *, const string& , const std::vector<std::vector<double>>& , const vector<double> &, const vector<double> &);
	


	static const string stringError;
	static const FFPoint pointError;
	static const FFVector vectorError;

public:

	// Reference time
	double refTime;

	// Definition of the structure 'Session'
	struct Session{
		SimulationParameters* params;
		FireDomain* fd;
		FireDomain* fdp;
		FireFront* ff;
		StringRepresentation* outStrRep;
		StringRepresentation* outStrRepp;
		TimeTable* tt;
		Simulator* sim;
		ostream* outStream;
		http_command::HttpCommandServer* server;
		int debugMode;
	};

	// Definition of the current session, on which the commands acts
	Session currentSession; /*!< session containing all the data of the ForeFire simulation */
	//static FireDomain* domain; /*!< pointer to the current fire domain */ 
	//static void setDomain(FireDomain*); /*!< pointer to the current fire domain */

	// Vector of outputs directories
	vector<string> outputDirs; /*!< vector of outputs directories */

	/*! \brief Default constructor */
	Command();

	/*! \brief getter of the singleton */
	static Command& instance() { return value; }
	/*! \brief Destructor */
	virtual ~Command();

	/*! \brief setting the reference time */
	void setReferenceTime(const double&);

	/*! \brief setting the start time of the step of simulation */
	void setStartTime(const double&);

	/*! \brief getting the current time of simulation */
	double getTime();

	/*! \brief managing the level */
	void increaseLevel();
	void decreaseLevel();

	/*! \brief accessor to the domain */
	FireDomain* getDomain();
	/*! \brief command to redirect the ostringstream */
	void setOstringstream(ostringstream*);

	/*! \brief execute the desired command */
	void ExecuteCommand(string&);
	void executeLoop(ifstream* inputStream);

	/*! \brief complete the last front */
	void completeFront(FireFront*);

	/*! \brief backup of the simulation */
	string dumpString();


};

}

#endif /* COMMAND_H_ */
